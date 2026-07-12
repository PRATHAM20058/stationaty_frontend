import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { Network } from '@capacitor/network';
import { App } from '@capacitor/app';
import { SqliteService } from './sqlite.service';
import { SyncTriggerService } from './sync-trigger.service';
import { CategoryService } from './category.service';
import { ItemService } from './item.service';
import { BillingService } from './billing.service';
import { SyncableEntityService } from './syncable';
import { SyncState } from '../models/sync.model';

const SYNC_INTERVAL_MS = 30_000;

/**
 * Background sync engine. Domain services apply writes to SQLite immediately and
 * push a row onto sync_queue; this service drains that queue whenever it believes
 * the server might be reachable (network change, app resume, on-demand trigger,
 * or a 30s heartbeat) and reports overall status for the UI badge/banner.
 *
 * Known limitation (v1, intentionally not solved): if two devices edit the same
 * item while both offline, last-synced-write wins. No merge/conflict resolution.
 */
@Injectable({ providedIn: 'root' })
export class SyncService {
  private stateSubject = new BehaviorSubject<SyncState>('offline');
  state$ = this.stateSubject.asObservable();

  private pendingCountSubject = new BehaviorSubject<number>(0);
  pendingCount$ = this.pendingCountSubject.asObservable();

  private isOnline = true;
  private syncing = false;
  private started = false;

  constructor(
    private sqlite: SqliteService,
    private categoryService: CategoryService,
    private itemService: ItemService,
    private billingService: BillingService,
    private syncTrigger: SyncTriggerService,
  ) {}

  /** Wires up listeners and kicks off an initial sync. Safe to call more than once. */
  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;

    await this.sqlite.whenReady();

    const status = await Network.getStatus();
    this.isOnline = status.connected;
    await this.refreshPendingCount();
    await this.updateState();

    Network.addListener('networkStatusChange', (s) => {
      this.isOnline = s.connected;
      this.updateState();
      if (this.isOnline) this.sync();
    });

    App.addListener('resume', () => {
      if (this.isOnline) this.sync();
    });

    this.syncTrigger.onTrigger$.subscribe(() => {
      if (this.isOnline) this.sync();
    });

    setInterval(() => {
      if (this.isOnline) this.sync();
    }, SYNC_INTERVAL_MS);

    if (this.isOnline) this.sync();
  }

  async sync(): Promise<void> {
    if (this.syncing || !this.isOnline) return;
    this.syncing = true;
    this.stateSubject.next('syncing');

    const idRemap = new Map<string, string>();
    try {
      const rows = await this.sqlite.query(`SELECT * FROM sync_queue WHERE status = 'pending' ORDER BY created_at ASC`);
      for (const row of rows) {
        const keepGoing = await this.processRow(row, idRemap);
        if (!keepGoing) break; // connectivity dropped mid-pass; stop, will retry on next trigger
      }
    } finally {
      this.syncing = false;
      await this.refreshPendingCount();
      await this.updateState();
    }
  }

  /** Returns false if the server appears unreachable (stop draining the rest of the queue). */
  private async processRow(row: any, idRemap: Map<string, string>): Promise<boolean> {
    const service = this.serviceFor(row.entity_type);
    if (!service) {
      await this.sqlite.run(`UPDATE sync_queue SET status = 'failed', error_message = 'unknown entity_type' WHERE id = ?`, [row.id]);
      return true;
    }

    let payload: any = {};
    try {
      payload = JSON.parse(row.payload);
    } catch {
      // ignore malformed payload, treated as empty below and will likely fail server-side
    }
    payload = this.applyRemap(payload, idRemap);

    try {
      if (row.action === 'create') {
        const { id: newId } = await service.pushCreate(row.entity_id, payload);
        if (newId && newId !== row.entity_id) {
          idRemap.set(row.entity_id, newId);
          if (service.remapLocalId) await service.remapLocalId(row.entity_id, newId);
        }
      } else if (row.action === 'update') {
        const targetId = idRemap.get(row.entity_id) ?? row.entity_id;
        await service.pushUpdate(targetId, payload);
      } else if (row.action === 'delete') {
        const targetId = idRemap.get(row.entity_id) ?? row.entity_id;
        await service.pushDelete(targetId);
      }
      await this.sqlite.run(`UPDATE sync_queue SET status = 'synced' WHERE id = ?`, [row.id]);
      return true;
    } catch (err: any) {
      if (err?.status === 0 || err?.status === undefined) {
        // Server unreachable (not just this request rejected) -- stop the pass, keep row pending.
        this.isOnline = false;
        return false;
      }
      // Server reachable but rejected the write (e.g. validation) -- park it, keep draining the rest.
      await this.sqlite.run(`UPDATE sync_queue SET status = 'failed', error_message = ? WHERE id = ?`, [
        String(err?.message ?? err),
        row.id,
      ]);
      return true;
    }
  }

  private applyRemap(payload: any, idRemap: Map<string, string>): any {
    if (!payload || typeof payload !== 'object') return payload;
    let next = payload;
    if (typeof next.categoryId === 'string' && idRemap.has(next.categoryId)) {
      next = { ...next, categoryId: idRemap.get(next.categoryId) };
    }
    if (Array.isArray(next.items)) {
      next = {
        ...next,
        items: next.items.map((line: any) =>
          typeof line?.itemId === 'string' && idRemap.has(line.itemId) ? { ...line, itemId: idRemap.get(line.itemId) } : line,
        ),
      };
    }
    return next;
  }

  private serviceFor(entityType: string): SyncableEntityService | undefined {
    switch (entityType) {
      case 'category':
        return this.categoryService;
      case 'item':
        return this.itemService;
      case 'bill':
        return this.billingService;
      default:
        return undefined;
    }
  }

  private async refreshPendingCount(): Promise<void> {
    const rows = await this.sqlite.query(`SELECT COUNT(*) as cnt FROM sync_queue WHERE status = 'pending'`);
    this.pendingCountSubject.next(rows[0]?.cnt ?? 0);
  }

  private async updateState(): Promise<void> {
    if (!this.isOnline) {
      this.stateSubject.next('offline');
      return;
    }
    const failedRows = await this.sqlite.query(`SELECT COUNT(*) as cnt FROM sync_queue WHERE status = 'failed'`);
    if ((failedRows[0]?.cnt ?? 0) > 0) {
      this.stateSubject.next('failed');
    } else if (this.pendingCountSubject.value > 0) {
      this.stateSubject.next('pending');
    } else {
      this.stateSubject.next('synced');
    }
  }
}
