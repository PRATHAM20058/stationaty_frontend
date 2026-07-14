import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom, Subject } from 'rxjs';
import { environment } from '../../../environments/environment';
import { Bill, BillItem, PaymentMethod, PaymentStatus } from '../models/bill.model';
import { SqliteService } from './sqlite.service';
import { SyncTriggerService } from './sync-trigger.service';
import { SyncableEntityService, generateLocalId } from './syncable';
import { ItemService } from './item.service';
import { SellerConfigService } from './seller-config.service';
import { calcGstBill } from '../utils/gst.util';

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
  // --- GST (optional; when isGstInvoice is falsy the bill behaves exactly as before) ---
  isGstInvoice?: boolean;
  buyerGstin?: string | null;
  buyerState?: string | null;
  buyerStateCode?: string | null;
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

  /** Emits when a bill's create syncs and its local temp id/number are replaced by the
      server-assigned id and 8-digit billNo. Lets an open bill-detail page swap in the real
      invoice number instead of the offline placeholder. */
  private readonly _remapped = new Subject<{ localId: string; serverId: string; billNo: string }>();
  readonly remapped$ = this._remapped.asObservable();
  /** Recent local->server id remaps, so a page that missed the live event (race) can still resolve. */
  private readonly recentRemaps = new Map<string, { serverId: string; billNo: string }>();

  /** Returns the server id/billNo a local temp bill id was remapped to on sync, if known. */
  resolveSyncedId(localId: string): { serverId: string; billNo: string } | undefined {
    return this.recentRemaps.get(localId);
  }

  constructor(
    private http: HttpClient,
    private sqlite: SqliteService,
    private syncTrigger: SyncTriggerService,
    private itemService: ItemService,
    private sellerConfig: SellerConfigService,
  ) {}

  async createBill(input: NewBillInput): Promise<Bill> {
    const id = generateLocalId();
    const billNo = `BILL-${Date.now()}`;
    const date = new Date().toISOString();
    const total = input.items.reduce((sum, it) => sum + it.subtotal, 0);

    const base: Bill = {
      id,
      billNo,
      customerName: input.customerName,
      customerPhone: input.customerPhone,
      date,
      items: input.items,
      discount: input.discount,
      total,
      grandTotal: Math.max(0, total - input.discount),
      paymentStatus: input.paymentStatus,
      amountPaid: input.amountPaid,
      amountDue: input.amountDue,
      paymentMethod: input.paymentMethod ?? null,
      chequeNo: input.chequeNo,
    };

    const bill = await this.enrichWithGst(base, {
      isGstInvoice: input.isGstInvoice,
      buyerGstin: input.buyerGstin,
      buyerState: input.buyerState,
      buyerStateCode: input.buyerStateCode,
    });

    await this.insertLocal(bill, true);

    // Reduce stock immediately, offline or not — each adjustment queues its own item sync.
    for (const line of input.items) {
      await this.itemService.adjustStock(line.itemId, -line.qty);
    }

    await this.enqueue('create', id, bill);
    this.syncTrigger.requestSync();
    return bill;
  }

  /**
   * Populates the GST fields of a bill from the current seller config. For a non-GST bill it
   * zeroes the tax fields and leaves grandTotal at total - discount, so the result is identical
   * to the legacy shape. For a GST invoice it computes per-line and bill-level tax via
   * calcGstBill and overrides grandTotal with the tax-inclusive, rounded value.
   */
  private async enrichWithGst(
    bill: Bill,
    gst: { isGstInvoice?: boolean; buyerGstin?: string | null; buyerState?: string | null; buyerStateCode?: string | null },
  ): Promise<Bill> {
    if (!gst.isGstInvoice) {
      return {
        ...bill,
        isGstInvoice: false,
        gstType: 'none',
        taxableAmount: bill.grandTotal,
        sgstTotal: 0,
        cgstTotal: 0,
        igstTotal: 0,
        roundOff: 0,
        items: bill.items.map((line) => ({
          ...line,
          gstPercent: 0,
          taxableValue: line.subtotal - line.discount,
          sgst: 0,
          cgst: 0,
          igst: 0,
        })),
      };
    }

    const seller = await this.sellerConfig.get();
    const result = calcGstBill(
      { isGstInvoice: true, buyerStateCode: gst.buyerStateCode, items: bill.items },
      seller,
    );

    return {
      ...bill,
      items: bill.items.map((line, i) => ({
        ...line,
        gstPercent: result.lines[i].gstPercent,
        taxableValue: result.lines[i].taxableValue,
        sgst: result.lines[i].sgst,
        cgst: result.lines[i].cgst,
        igst: result.lines[i].igst,
      })),
      grandTotal: result.grandTotal,
      isGstInvoice: true,
      gstType: result.gstType,
      sellerGstin: seller.sellerGstin,
      sellerStateCode: seller.sellerStateCode,
      buyerGstin: gst.buyerGstin ?? null,
      buyerState: gst.buyerState ?? null,
      buyerStateCode: gst.buyerStateCode ?? null,
      taxableAmount: result.taxableAmount,
      sgstTotal: result.sgstTotal,
      cgstTotal: result.cgstTotal,
      igstTotal: result.igstTotal,
      roundOff: result.roundOff,
      amountInWords: result.amountInWords,
    };
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

    // Recompute GST (if any) first so the grand total the payment figures key off is tax-inclusive.
    const enriched = await this.enrichWithGst(
      { ...existing, items, total, discount, grandTotal: Math.max(0, total - discount) },
      {
        isGstInvoice: existing.isGstInvoice,
        buyerGstin: existing.buyerGstin,
        buyerState: existing.buyerState,
        buyerStateCode: existing.buyerStateCode,
      },
    );
    const grandTotal = enriched.grandTotal;

    // Keep the payment figures consistent with the new grand total.
    let amountPaid: number;
    if (existing.paymentStatus === 'paid') amountPaid = grandTotal;
    else if (existing.paymentStatus === 'pending') amountPaid = 0;
    else amountPaid = Math.min(existing.amountPaid, grandTotal);
    const amountDue = Math.max(0, grandTotal - amountPaid);
    const paymentStatus: PaymentStatus = amountDue <= 0 ? 'paid' : amountPaid > 0 ? 'partial' : 'pending';

    const updated: Bill = {
      ...enriched,
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
        statement: `INSERT INTO bills (id, bill_no, customer_name, customer_phone, date, discount, total, grand_total, payment_status, amount_paid, amount_due, payment_method, cheque_no,
            is_gst_invoice, gst_type, seller_gstin, seller_state_code, buyer_gstin, buyer_state, buyer_state_code, taxable_amount, sgst_total, cgst_total, igst_total, round_off, amount_in_words, pending_sync)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            bill_no = excluded.bill_no, customer_name = excluded.customer_name, customer_phone = excluded.customer_phone,
            date = excluded.date, discount = excluded.discount, total = excluded.total, grand_total = excluded.grand_total,
            payment_status = excluded.payment_status, amount_paid = excluded.amount_paid, amount_due = excluded.amount_due,
            payment_method = excluded.payment_method, cheque_no = excluded.cheque_no,
            is_gst_invoice = excluded.is_gst_invoice, gst_type = excluded.gst_type, seller_gstin = excluded.seller_gstin,
            seller_state_code = excluded.seller_state_code, buyer_gstin = excluded.buyer_gstin, buyer_state = excluded.buyer_state,
            buyer_state_code = excluded.buyer_state_code, taxable_amount = excluded.taxable_amount, sgst_total = excluded.sgst_total,
            cgst_total = excluded.cgst_total, igst_total = excluded.igst_total, round_off = excluded.round_off,
            amount_in_words = excluded.amount_in_words, pending_sync = excluded.pending_sync`,
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
          bill.isGstInvoice ? 1 : 0,
          bill.gstType ?? 'none',
          bill.sellerGstin ?? null,
          bill.sellerStateCode ?? null,
          bill.buyerGstin ?? null,
          bill.buyerState ?? null,
          bill.buyerStateCode ?? null,
          bill.taxableAmount ?? 0,
          bill.sgstTotal ?? 0,
          bill.cgstTotal ?? 0,
          bill.igstTotal ?? 0,
          bill.roundOff ?? 0,
          bill.amountInWords ?? null,
          pendingSync ? 1 : 0,
        ],
      },
      { statement: `DELETE FROM bill_items WHERE bill_id = ?`, values: [bill.id] },
      ...bill.items.map((line) => ({
        statement: `INSERT INTO bill_items (bill_id, item_id, item_name, qty, price, subtotal, discount, hsn_code, gst_percent, taxable_value, sgst, cgst, igst)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        values: [
          bill.id,
          line.itemId,
          line.itemName,
          line.qty,
          line.price,
          line.subtotal,
          line.discount ?? 0,
          line.hsnCode ?? null,
          line.gstPercent ?? 0,
          line.taxableValue ?? line.subtotal - (line.discount ?? 0),
          line.sgst ?? 0,
          line.cgst ?? 0,
          line.igst ?? 0,
        ],
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
      // Notify any open bill-detail page so it can show the server's 8-digit invoice number.
      this.recentRemaps.set(entityId, { serverId: created.id, billNo: created.billNo });
      this._remapped.next({ localId: entityId, serverId: created.id, billNo: created.billNo });
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
      isGstInvoice: !!billRow.is_gst_invoice,
      gstType: billRow.gst_type ?? 'none',
      sellerGstin: billRow.seller_gstin ?? undefined,
      sellerStateCode: billRow.seller_state_code ?? undefined,
      buyerGstin: billRow.buyer_gstin ?? null,
      buyerState: billRow.buyer_state ?? null,
      buyerStateCode: billRow.buyer_state_code ?? null,
      taxableAmount: billRow.taxable_amount ?? 0,
      sgstTotal: billRow.sgst_total ?? 0,
      cgstTotal: billRow.cgst_total ?? 0,
      igstTotal: billRow.igst_total ?? 0,
      roundOff: billRow.round_off ?? 0,
      amountInWords: billRow.amount_in_words ?? undefined,
      pendingSync: !!billRow.pending_sync,
      items: itemRows.map((ir) => ({
        itemId: ir.item_id,
        itemName: ir.item_name,
        qty: ir.qty,
        price: ir.price,
        subtotal: ir.subtotal,
        discount: ir.discount ?? 0,
        hsnCode: ir.hsn_code ?? null,
        gstPercent: ir.gst_percent ?? 0,
        taxableValue: ir.taxable_value ?? undefined,
        sgst: ir.sgst ?? 0,
        cgst: ir.cgst ?? 0,
        igst: ir.igst ?? 0,
      })),
    };
  }
}
