export type ItemUnit = 'pcs' | 'box' | 'dozen' | 'pack';

export interface Item {
  id: string;
  name: string;
  categoryId: string;
  category?: string;
  purchasePrice: number;
  sellingPrice: number;
  stockQty: number;
  unit: ItemUnit;
  sku?: string;
  godownLocation?: string;
  /** Present only while a local create/update/delete hasn't reached the server yet. */
  pendingSync?: boolean;
}
