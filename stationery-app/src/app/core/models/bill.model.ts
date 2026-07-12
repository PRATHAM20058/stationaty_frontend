export type PaymentStatus = 'paid' | 'pending' | 'partial';
export type PaymentMethod = 'cash' | 'upi' | 'cheque' | null;

export interface BillItem {
  itemId: string;
  itemName: string;
  qty: number;
  price: number;
  /** Gross line amount (qty x price), before this line's discount. */
  subtotal: number;
  /** Monetary discount applied to this line only -- bills are discounted per item, not as a whole. */
  discount: number;
}

export interface Bill {
  id: string;
  billNo: string;
  customerName: string;
  customerPhone?: string;
  date: string;
  items: BillItem[];
  discount: number;
  total: number;
  grandTotal: number;
  paymentStatus: PaymentStatus;
  amountPaid: number;
  amountDue: number;
  paymentMethod?: PaymentMethod;
  /** Only meaningful when paymentMethod is 'cheque'. May be added after the bill is created. */
  chequeNo?: string;
  /** Present only while a local create/update/delete hasn't reached the server yet. */
  pendingSync?: boolean;
}
