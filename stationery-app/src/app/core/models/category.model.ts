export interface Category {
  id: string;
  name: string;
  itemCount?: number;
  /** Present only while a local create/update/delete hasn't reached the server yet. */
  pendingSync?: boolean;
}
