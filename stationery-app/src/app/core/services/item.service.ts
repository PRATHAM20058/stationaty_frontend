import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom, Subject } from 'rxjs';
import { environment } from '../../../environments/environment';
import { Item } from '../models/item.model';
import { SqliteService } from './sqlite.service';
import { SyncTriggerService } from './sync-trigger.service';
import { SyncableEntityService, generateLocalId } from './syncable';

export interface ItemFilter {
  search?: string;
  categoryId?: string;
}

@Injectable({ providedIn: 'root' })
export class ItemService implements SyncableEntityService {
  private readonly _changes = new Subject<void>();
  /** Emits after any local item create/update/delete (including stock adjustments from
      billing) so list pages can live-refresh even while they're a backgrounded cached tab. */
  readonly changes$ = this._changes.asObservable();

  constructor(
    private http: HttpClient,
    private sqlite: SqliteService,
    private syncTrigger: SyncTriggerService,
  ) {}

  async list(filter: ItemFilter = {}): Promise<Item[]> {
    const clauses: string[] = [];
    const values: unknown[] = [];

    if (filter.search) {
      clauses.push(`(i.name LIKE ? OR i.godown_location LIKE ? OR i.sku LIKE ?)`);
      const term = `%${filter.search}%`;
      values.push(term, term, term);
    }
    if (filter.categoryId) {
      clauses.push(`i.category_id = ?`);
      values.push(filter.categoryId);
    }

    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const rows = await this.sqlite.query(
      `SELECT i.*, c.name as category_name FROM items i
       LEFT JOIN categories c ON c.id = i.category_id
       ${where}
       ORDER BY i.name COLLATE NOCASE`,
      values,
    );
    return rows.map((r) => this.rowToModel(r));
  }

  async getById(id: string): Promise<Item | undefined> {
    const rows = await this.sqlite.query(
      `SELECT i.*, c.name as category_name FROM items i LEFT JOIN categories c ON c.id = i.category_id WHERE i.id = ?`,
      [id],
    );
    return rows.length ? this.rowToModel(rows[0]) : undefined;
  }

  async lowStock(threshold = environment.lowStockThreshold): Promise<Item[]> {
    const rows = await this.sqlite.query(
      `SELECT i.*, c.name as category_name FROM items i LEFT JOIN categories c ON c.id = i.category_id
       WHERE i.stock_qty <= ? ORDER BY i.stock_qty ASC`,
      [threshold],
    );
    return rows.map((r) => this.rowToModel(r));
  }

  async refreshFromServer(): Promise<void> {
    const items = await firstValueFrom(this.http.get<Item[]>(`${environment.apiUrl}/items`));
    for (const it of items) {
      await this.upsertLocal(it, false);
    }
  }

  async create(item: Omit<Item, 'id'>): Promise<Item> {
    const id = generateLocalId();
    const full: Item = { ...item, id };
    await this.upsertLocal(full, true);
    await this.enqueue('create', id, item);
    this.syncTrigger.requestSync();
    return full;
  }

  async update(id: string, item: Omit<Item, 'id'>): Promise<void> {
    await this.upsertLocal({ ...item, id }, true);
    await this.enqueue('update', id, item);
    this.syncTrigger.requestSync();
  }

  async delete(id: string): Promise<void> {
    await this.sqlite.run(`DELETE FROM items WHERE id = ?`, [id]);
    await this.enqueue('delete', id, {});
    this.syncTrigger.requestSync();
  }

  /** Reduces stock locally as part of billing; queues an update so the server stays in sync. */
  async adjustStock(id: string, delta: number): Promise<void> {
    const item = await this.getById(id);
    if (!item) return;
    const newQty = Math.max(0, item.stockQty + delta);
    await this.update(id, { ...this.stripDerived(item), stockQty: newQty });
  }

  private stripDerived(item: Item): Omit<Item, 'id'> {
    const { id, ...rest } = item;
    return rest;
  }

  private async upsertLocal(item: Item, pendingSync: boolean): Promise<void> {
    await this.sqlite.run(
      `INSERT INTO items (id, name, category_id, category, purchase_price, selling_price, stock_qty, unit, sku, godown_location, hsn_code, gst_percent, pending_sync)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name, category_id = excluded.category_id, category = excluded.category,
         purchase_price = excluded.purchase_price, selling_price = excluded.selling_price,
         stock_qty = excluded.stock_qty, unit = excluded.unit, sku = excluded.sku,
         godown_location = excluded.godown_location, hsn_code = excluded.hsn_code,
         gst_percent = excluded.gst_percent, pending_sync = excluded.pending_sync`,
      [
        item.id,
        item.name,
        item.categoryId,
        item.category ?? null,
        item.purchasePrice,
        item.sellingPrice,
        item.stockQty,
        item.unit,
        item.sku ?? null,
        item.godownLocation ?? null,
        item.hsnCode ?? null,
        item.gstPercent ?? null,
        pendingSync ? 1 : 0,
      ],
    );
  }

  private async enqueue(action: 'create' | 'update' | 'delete', entityId: string, payload: unknown): Promise<void> {
    await this.sqlite.run(
      `INSERT INTO sync_queue (entity_type, action, entity_id, payload, status, created_at) VALUES ('item', ?, ?, ?, 'pending', ?)`,
      [action, entityId, JSON.stringify(payload), new Date().toISOString()],
    );
    // Every user-initiated item mutation funnels through here -- notify subscribed list/summary pages.
    this._changes.next();
  }

  // --- SyncableEntityService: called by SyncService while draining the queue ---

  async pushCreate(entityId: string, payload: any): Promise<{ id: string }> {
    const created = await firstValueFrom(this.http.post<Item>(`${environment.apiUrl}/items`, payload));
    if (created.id !== entityId) {
      await this.sqlite.run(`UPDATE items SET id = ?, pending_sync = 0 WHERE id = ?`, [created.id, entityId]);
    } else {
      await this.sqlite.run(`UPDATE items SET pending_sync = 0 WHERE id = ?`, [entityId]);
    }
    return { id: created.id };
  }

  async pushUpdate(entityId: string, payload: any): Promise<void> {
    await firstValueFrom(this.http.put(`${environment.apiUrl}/items/${entityId}`, payload));
    await this.sqlite.run(`UPDATE items SET pending_sync = 0 WHERE id = ?`, [entityId]);
  }

  async pushDelete(entityId: string): Promise<void> {
    await firstValueFrom(this.http.delete(`${environment.apiUrl}/items/${entityId}`));
  }

  private rowToModel(row: any): Item {
    return {
      id: row.id,
      name: row.name,
      categoryId: row.category_id,
      category: row.category_name ?? row.category ?? undefined,
      purchasePrice: row.purchase_price,
      sellingPrice: row.selling_price,
      stockQty: row.stock_qty,
      unit: row.unit,
      sku: row.sku ?? undefined,
      godownLocation: row.godown_location ?? undefined,
      hsnCode: row.hsn_code ?? null,
      gstPercent: row.gst_percent ?? null,
      pendingSync: !!row.pending_sync,
    };
  }
}
