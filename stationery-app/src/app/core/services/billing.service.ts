import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom, Subject } from 'rxjs';
import { environment } from '../../../environments/environment';
import { Bill, BillItem, PaymentMethod, PaymentStatus } from '../models/bill.model';
import { SqliteService } from './sqlite.service';
import { SyncTriggerService } from './sync-trigger.service';
import { SyncableEntityService, generateLocalId } from './syncable';
import { ItemService } from './item.service';

export interface NewBillInput {
  customerName: string;
  customerPhone?: string;
  items: BillItem[];
  discount: number;
  paymentStatus: PaymentStatus;
  amountPaid: number;
  amountDue: number;
  paymentMethod?: PaymentMethod;
  chequeNo?: string;
}

export interface BillFilter {
  from?: string;
  to?: string;
  paymentStatus?: PaymentStatus | PaymentStatus[];
  customerName?: string;
  customerPhone?: string;
  /** Free-text search matching either the customer name or their phone number. */
  search?: string;
}

@Injectable({ providedIn: 'root' })
export class BillingService implements SyncableEntityService {
  private readonly _changes = new Subject<void>();
  /** Emits after any local bill create/update/delete/payment so summary pages (dashboard,
      reports) can live-refresh even while they're a backgrounded cached tab. */
  readonly changes$ = this._changes.asObservable();

  constructor(
    private http: HttpClient,
    private sqlite: SqliteService,
    private syncTrigger: SyncTriggerService,
    private itemService: ItemService,
  ) {}

  async createBill(input: NewBillInput): Promise<Bill> {
    const id = generateLocalId();
    const billNo = `BILL-${Date.now()}`;
    const date = new Date().toISOString();
    const total = input.items.reduce((sum, it) => sum + it.subtotal, 0);
    const grandTotal = Math.max(0, total - input.discount);

    const bill: Bill = {
      id,
      billNo,
      customerName: input.customerName,
      customerPhone: input.customerPhone,
      date,
      items: input.items,
      discount: input.discount,
      total,
      grandTotal,
      paymentStatus: input.paymentStatus,
      amountPaid: input.amountPaid,
      amountDue: input.amountDue,
      paymentMethod: input.paymentMethod ?? null,
      chequeNo: input.chequeNo,
    };

    await this.insertLocal(bill, true);

    // Reduce stock immediately, offline or not — each adjustment queues its own item sync.
    for (const line of input.items) {
      await this.itemService.adjustStock(line.itemId, -line.qty);
    }

    await this.enqueue('create', id, bill);
    this.syncTrigger.requestSync();
    return bill;
  }

  /** Deletes a bill and puts the quantities its lines had consumed back into stock. */
  async deleteBill(id: string): Promise<void> {
    const bill = await this.getBillById(id);
    if (!bill) return;
    for (const line of bill.items) {
      await this.itemService.adjustStock(line.itemId, line.qty);
    }
    await this.sqlite.runBatch([
      { statement: `DELETE FROM bill_items WHERE bill_id = ?`, values: [id] },
      { statement: `DELETE FROM bills WHERE id = ?`, values: [id] },
    ]);
    await this.enqueue('delete', id, {});
    this.syncTrigger.requestSync();
  }

  /**
   * Replaces a bill's line items (e.g. removing a wrongly-added item) and
   * recomputes totals, payment amounts, and stock to match.
   */
  async updateBillItems(billId: string, items: BillItem[]): Promise<Bill | undefined> {
    const existing = await this.getBillById(billId);
    if (!existing) return undefined;

    // Adjust stock by the delta between the old and new quantities per item.
    const newQtyById = new Map(items.map((i) => [i.itemId, i.qty]));
    for (const oldLine of existing.items) {
      const delta = oldLine.qty - (newQtyById.get(oldLine.itemId) ?? 0);
      if (delta !== 0) await this.itemService.adjustStock(oldLine.itemId, delta);
    }

    const total = items.reduce((sum, it) => sum + it.subtotal, 0);
    const discount = items.reduce((sum, it) => sum + it.discount, 0);
    const grandTotal = Math.max(0, total - discount);

    // Keep the payment figures consistent with the new grand total.
    let amountPaid: number;
    if (existing.paymentStatus === 'paid') amountPaid = grandTotal;
    else if (existing.paymentStatus === 'pending') amountPaid = 0;
    else amountPaid = Math.min(existing.amountPaid, grandTotal);
    const amountDue = Math.max(0, grandTotal - amountPaid);
    const paymentStatus: PaymentStatus = amountDue <= 0 ? 'paid' : amountPaid > 0 ? 'partial' : 'pending';

    const updated: Bill = {
      ...existing,
      items,
      total,
      discount,
      grandTotal,
      amountPaid,
      amountDue,
      paymentStatus,
      pendingSync: true,
    };

    await this.insertLocal(updated, true);
    await this.enqueue('update', billId, updated);
    this.syncTrigger.requestSync();
    return updated;
  }

  async getBillById(id: string): Promise<Bill | undefined> {
    const billRows = await this.sqlite.query(`SELECT * FROM bills WHERE id = ?`, [id]);
    if (!billRows.length) return undefined;
    const itemRows = await this.sqlite.query(`SELECT * FROM bill_items WHERE bill_id = ?`, [id]);
    return this.rowToModel(billRows[0], itemRows);
  }

  async listBills(filter: BillFilter = {}): Promise<Bill[]> {
    const clauses: string[] = [];
    const values: unknown[] = [];

    if (filter.from) {
      clauses.push(`date >= ?`);
      values.push(filter.from);
    }
    if (filter.to) {
      clauses.push(`date <= ?`);
      values.push(filter.to);
    }
    if (filter.paymentStatus) {
      const statuses = Array.isArray(filter.paymentStatus) ? filter.paymentStatus : [filter.paymentStatus];
      clauses.push(`payment_status IN (${statuses.map(() => '?').join(',')})`);
      values.push(...statuses);
    }
    if (filter.customerName) {
      clauses.push(`customer_name LIKE ?`);
      values.push(`%${filter.customerName}%`);
    }
    if (filter.customerPhone) {
      clauses.push(`customer_phone LIKE ?`);
      values.push(`%${filter.customerPhone}%`);
    }
    if (filter.search) {
      clauses.push(`(customer_name LIKE ? OR customer_phone LIKE ?)`);
      values.push(`%${filter.search}%`, `%${filter.search}%`);
    }

    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const billRows = await this.sqlite.query(`SELECT * FROM bills ${where} ORDER BY date DESC`, values);
    if (!billRows.length) return [];

    const ids: string[] = billRows.map((r) => r.id);
    const placeholders = ids.map(() => '?').join(',');
    const itemRows = await this.sqlite.query(`SELECT * FROM bill_items WHERE bill_id IN (${placeholders})`, ids);

    return billRows.map((br) => this.rowToModel(br, itemRows.filter((ir) => ir.bill_id === br.id)));
  }

  async listPendingBills(): Promise<Bill[]> {
    const bills = await this.listBills({ paymentStatus: ['pending', 'partial'] });
    return bills.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  }

  async getTodaySummary(): Promise<{ totalSales: number; billCount: number }> {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const bills = await this.listBills({ from: startOfDay.toISOString() });
    return {
      totalSales: bills.reduce((sum, b) => sum + b.amountPaid, 0),
      billCount: bills.length,
    };
  }

  /** Best sellers in a period, ranked by revenue (net of per-line discounts). */
  async getTopItems(from: string, limit = 5): Promise<{ itemName: string; qtySold: number; revenue: number }[]> {
    const rows = await this.sqlite.query(
      `SELECT bi.item_name, SUM(bi.qty) as qty_sold, SUM(bi.subtotal - COALESCE(bi.discount, 0)) as revenue
       FROM bill_items bi
       JOIN bills b ON b.id = bi.bill_id
       WHERE b.date >= ?
       GROUP BY bi.item_name
       ORDER BY revenue DESC
       LIMIT ?`,
      [from, limit],
    );
    return rows.map((r: any) => ({ itemName: r.item_name, qtySold: r.qty_sold, revenue: r.revenue }));
  }

  /** Weakest sellers in a period (lowest revenue among items that sold at least once), for spotting slow-moving stock. */
  async getLowItems(from: string, limit = 5): Promise<{ itemName: string; qtySold: number; revenue: number }[]> {
    const rows = await this.sqlite.query(
      `SELECT bi.item_name, SUM(bi.qty) as qty_sold, SUM(bi.subtotal - COALESCE(bi.discount, 0)) as revenue
       FROM bill_items bi
       JOIN bills b ON b.id = bi.bill_id
       WHERE b.date >= ?
       GROUP BY bi.item_name
       HAVING SUM(bi.qty) > 0
       ORDER BY revenue ASC
       LIMIT ?`,
      [from, limit],
    );
    return rows.map((r: any) => ({ itemName: r.item_name, qtySold: r.qty_sold, revenue: r.revenue }));
  }

  async getPendingSummary(): Promise<{ totalDue: number; count: number }> {
    const bills = await this.listPendingBills();
    return {
      totalDue: bills.reduce((sum, b) => sum + b.amountDue, 0),
      count: bills.length,
    };
  }

  async markAsPaid(billId: string, paymentMethod: PaymentMethod, chequeNo?: string): Promise<void> {
    await this.sqlite.run(
      `UPDATE bills SET payment_status = 'paid', amount_paid = grand_total, amount_due = 0, payment_method = ?, cheque_no = ?, pending_sync = 1 WHERE id = ?`,
      [paymentMethod, chequeNo ?? null, billId],
    );
    await this.enqueuePaymentUpdate(billId);
  }

  async recordPartialPayment(billId: string, amountReceived: number, paymentMethod: PaymentMethod, chequeNo?: string): Promise<void> {
    const bill = await this.getBillById(billId);
    if (!bill) return;
    const amountPaid = bill.amountPaid + amountReceived;
    const amountDue = Math.max(0, bill.grandTotal - amountPaid);
    const paymentStatus: PaymentStatus = amountDue <= 0 ? 'paid' : 'partial';

    await this.sqlite.run(
      `UPDATE bills SET payment_status = ?, amount_paid = ?, amount_due = ?, payment_method = ?, cheque_no = ?, pending_sync = 1 WHERE id = ?`,
      [paymentStatus, amountPaid, amountDue, paymentMethod, chequeNo ?? null, billId],
    );
    await this.enqueuePaymentUpdate(billId);
  }

  /** Adds or updates just the cheque number on an existing bill (e.g. filled in after the bill was generated). */
  async updateChequeNo(billId: string, chequeNo: string): Promise<void> {
    await this.sqlite.run(`UPDATE bills SET cheque_no = ?, pending_sync = 1 WHERE id = ?`, [chequeNo, billId]);
    await this.enqueuePaymentUpdate(billId);
  }

  private async enqueuePaymentUpdate(billId: string): Promise<void> {
    const bill = await this.getBillById(billId);
    await this.enqueue('update', billId, {
      paymentStatus: bill?.paymentStatus,
      amountPaid: bill?.amountPaid,
      amountDue: bill?.amountDue,
      paymentMethod: bill?.paymentMethod,
      chequeNo: bill?.chequeNo,
    });
    this.syncTrigger.requestSync();
  }

  async refreshFromServer(): Promise<void> {
    const bills = await firstValueFrom(this.http.get<Bill[]>(`${environment.apiUrl}/bills`));
    for (const b of bills) {
      await this.insertLocal(b, false);
    }
  }

  private async insertLocal(bill: Bill, pendingSync: boolean): Promise<void> {
    await this.sqlite.runBatch([
      {
        statement: `INSERT INTO bills (id, bill_no, customer_name, customer_phone, date, discount, total, grand_total, payment_status, amount_paid, amount_due, payment_method, cheque_no, pending_sync)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            bill_no = excluded.bill_no, customer_name = excluded.customer_name, customer_phone = excluded.customer_phone,
            date = excluded.date, discount = excluded.discount, total = excluded.total, grand_total = excluded.grand_total,
            payment_status = excluded.payment_status, amount_paid = excluded.amount_paid, amount_due = excluded.amount_due,
            payment_method = excluded.payment_method, cheque_no = excluded.cheque_no, pending_sync = excluded.pending_sync`,
        values: [
          bill.id,
          bill.billNo,
          bill.customerName,
          bill.customerPhone ?? null,
          bill.date,
          bill.discount,
          bill.total,
          bill.grandTotal,
          bill.paymentStatus,
          bill.amountPaid,
          bill.amountDue,
          bill.paymentMethod ?? null,
          bill.chequeNo ?? null,
          pendingSync ? 1 : 0,
        ],
      },
      { statement: `DELETE FROM bill_items WHERE bill_id = ?`, values: [bill.id] },
      ...bill.items.map((line) => ({
        statement: `INSERT INTO bill_items (bill_id, item_id, item_name, qty, price, subtotal, discount) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        values: [bill.id, line.itemId, line.itemName, line.qty, line.price, line.subtotal, line.discount ?? 0],
      })),
    ]);
  }

  private async enqueue(action: 'create' | 'update' | 'delete', entityId: string, payload: unknown): Promise<void> {
    await this.sqlite.run(
      `INSERT INTO sync_queue (entity_type, action, entity_id, payload, status, created_at) VALUES ('bill', ?, ?, ?, 'pending', ?)`,
      [action, entityId, JSON.stringify(payload), new Date().toISOString()],
    );
    // Every user-initiated bill mutation funnels through here -- notify subscribed summary pages.
    this._changes.next();
  }

  // --- SyncableEntityService: called by SyncService while draining the queue ---

  async pushCreate(entityId: string, payload: any): Promise<{ id: string }> {
    const created = await firstValueFrom(this.http.post<Bill>(`${environment.apiUrl}/bills`, payload));
    if (created.id !== entityId) {
      await this.sqlite.runBatch([
        { statement: `UPDATE bills SET id = ?, bill_no = ?, pending_sync = 0 WHERE id = ?`, values: [created.id, created.billNo, entityId] },
        { statement: `UPDATE bill_items SET bill_id = ? WHERE bill_id = ?`, values: [created.id, entityId] },
      ]);
    } else {
      await this.sqlite.run(`UPDATE bills SET pending_sync = 0 WHERE id = ?`, [entityId]);
    }
    return { id: created.id };
  }

  async pushUpdate(entityId: string, payload: any): Promise<void> {
    await firstValueFrom(this.http.put(`${environment.apiUrl}/bills/${entityId}/payment`, payload));
    await this.sqlite.run(`UPDATE bills SET pending_sync = 0 WHERE id = ?`, [entityId]);
  }

  async pushDelete(entityId: string): Promise<void> {
    await firstValueFrom(this.http.delete(`${environment.apiUrl}/bills/${entityId}`));
  }

  private rowToModel(billRow: any, itemRows: any[]): Bill {
    return {
      id: billRow.id,
      billNo: billRow.bill_no,
      customerName: billRow.customer_name,
      customerPhone: billRow.customer_phone ?? undefined,
      date: billRow.date,
      discount: billRow.discount,
      total: billRow.total,
      grandTotal: billRow.grand_total,
      paymentStatus: billRow.payment_status,
      amountPaid: billRow.amount_paid,
      amountDue: billRow.amount_due,
      paymentMethod: billRow.payment_method ?? null,
      chequeNo: billRow.cheque_no ?? undefined,
      pendingSync: !!billRow.pending_sync,
      items: itemRows.map((ir) => ({
        itemId: ir.item_id,
        itemName: ir.item_name,
        qty: ir.qty,
        price: ir.price,
        subtotal: ir.subtotal,
        discount: ir.discount ?? 0,
      })),
    };
  }
}
