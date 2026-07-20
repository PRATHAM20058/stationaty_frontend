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
  /** HSN/SAC code for GST invoicing. Optional (legacy items have none); prompted at billing time when needed. */
  hsnCode?: string | null;
  /** GST rate for this item: one of 0, 5, 12, 18, 28. Null on legacy items. */
  gstPercent?: number | null;
  /** Present only while a local create/update/delete hasn't reached the server yet. */
  pendingSync?: boolean;
}

/** GST rates the app offers in the item form / billing dropdowns. */
export const GST_PERCENT_OPTIONS = [0, 5, 12, 18, 28] as const;
