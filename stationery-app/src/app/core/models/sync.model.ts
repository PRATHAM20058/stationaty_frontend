export type SyncEntityType = 'item' | 'category' | 'bill';
export type SyncAction = 'create' | 'update' | 'delete';
export type SyncStatus = 'pending' | 'synced' | 'failed';

export interface SyncQueueItem {
  id: number;
  entityType: SyncEntityType;
  action: SyncAction;
  entityId: string;
  payload: string;
  status: SyncStatus;
  createdAt: string;
  errorMessage?: string;
}

export type SyncState = 'synced' | 'syncing' | 'pending' | 'failed' | 'offline';
