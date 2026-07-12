/** Implemented by every domain service SyncService knows how to replay a queued write for. */
export interface SyncableEntityService {
  pushCreate(entityId: string, payload: unknown): Promise<{ id: string }>;
  pushUpdate(entityId: string, payload: unknown): Promise<void>;
  pushDelete(entityId: string): Promise<void>;
  /** Cascades a real server id into any local rows that still reference the temporary local id (e.g. items.category_id). */
  remapLocalId?(oldId: string, newId: string): Promise<void>;
}

export function generateLocalId(): string {
  return `local-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
}

export function isLocalId(id: string): boolean {
  return id.startsWith('local-');
}
