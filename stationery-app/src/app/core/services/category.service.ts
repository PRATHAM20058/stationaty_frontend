import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { Category } from '../models/category.model';
import { SqliteService } from './sqlite.service';
import { SyncTriggerService } from './sync-trigger.service';
import { SyncableEntityService, generateLocalId } from './syncable';

@Injectable({ providedIn: 'root' })
export class CategoryService implements SyncableEntityService {
  constructor(
    private http: HttpClient,
    private sqlite: SqliteService,
    private syncTrigger: SyncTriggerService,
  ) {}

  /** Always reads the local cache first so the UI is instant and works offline. */
  async list(): Promise<Category[]> {
    const rows = await this.sqlite.query(
      `SELECT c.id, c.name, c.pending_sync, COUNT(i.id) as item_count
       FROM categories c
       LEFT JOIN items i ON i.category_id = c.id
       GROUP BY c.id, c.name, c.pending_sync
       ORDER BY c.name COLLATE NOCASE`,
    );
    return rows.map((r) => this.rowToModel(r));
  }

  /** Fetches from the server and overwrites the local cache. Call opportunistically when online. */
  async refreshFromServer(): Promise<void> {
    const categories = await firstValueFrom(this.http.get<Category[]>(`${environment.apiUrl}/categories`));
    for (const c of categories) {
      await this.sqlite.run(
        `INSERT INTO categories (id, name, pending_sync) VALUES (?, ?, 0)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, pending_sync = 0`,
        [c.id, c.name],
      );
    }
  }

  async create(name: string): Promise<Category> {
    const id = generateLocalId();
    await this.sqlite.run(`INSERT INTO categories (id, name, pending_sync) VALUES (?, ?, 1)`, [id, name]);
    await this.enqueue('create', id, { name });
    this.syncTrigger.requestSync();
    return { id, name };
  }

  async update(id: string, name: string): Promise<void> {
    await this.sqlite.run(`UPDATE categories SET name = ?, pending_sync = 1 WHERE id = ?`, [name, id]);
    await this.enqueue('update', id, { name });
    this.syncTrigger.requestSync();
  }

  async delete(id: string): Promise<void> {
    await this.sqlite.run(`DELETE FROM categories WHERE id = ?`, [id]);
    await this.enqueue('delete', id, {});
    this.syncTrigger.requestSync();
  }

  private async enqueue(action: 'create' | 'update' | 'delete', entityId: string, payload: unknown): Promise<void> {
    await this.sqlite.run(
      `INSERT INTO sync_queue (entity_type, action, entity_id, payload, status, created_at) VALUES ('category', ?, ?, ?, 'pending', ?)`,
      [action, entityId, JSON.stringify(payload), new Date().toISOString()],
    );
  }

  // --- SyncableEntityService: called by SyncService while draining the queue ---

  async pushCreate(entityId: string, payload: any): Promise<{ id: string }> {
    const created = await firstValueFrom(this.http.post<Category>(`${environment.apiUrl}/categories`, payload));
    if (created.id !== entityId) {
      await this.sqlite.run(`UPDATE categories SET id = ?, pending_sync = 0 WHERE id = ?`, [created.id, entityId]);
    } else {
      await this.sqlite.run(`UPDATE categories SET pending_sync = 0 WHERE id = ?`, [entityId]);
    }
    return { id: created.id };
  }

  async pushUpdate(entityId: string, payload: any): Promise<void> {
    await firstValueFrom(this.http.put(`${environment.apiUrl}/categories/${entityId}`, payload));
    await this.sqlite.run(`UPDATE categories SET pending_sync = 0 WHERE id = ?`, [entityId]);
  }

  async pushDelete(entityId: string): Promise<void> {
    await firstValueFrom(this.http.delete(`${environment.apiUrl}/categories/${entityId}`));
  }

  async remapLocalId(oldId: string, newId: string): Promise<void> {
    await this.sqlite.run(`UPDATE items SET category_id = ? WHERE category_id = ?`, [newId, oldId]);
  }

  private rowToModel(row: any): Category {
    return {
      id: row.id,
      name: row.name,
      itemCount: row.item_count ?? 0,
      pendingSync: !!row.pending_sync,
    };
  }
}
