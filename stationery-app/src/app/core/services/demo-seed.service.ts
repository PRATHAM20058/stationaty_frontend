import { Injectable } from '@angular/core';
import { SqliteService } from './sqlite.service';

interface DemoBillLine {
  itemId: string;
  itemName: string;
  qty: number;
  price: number;
}

interface DemoBill {
  id: string;
  billNo: string;
  customerName: string;
  customerPhone: string | null;
  daysAgo: number;
  hoursAgo?: number;
  items: DemoBillLine[];
  discount: number;
  paymentStatus: 'paid' | 'pending' | 'partial';
  amountPaid: number;
  paymentMethod: 'cash' | 'upi' | 'cheque' | null;
  chequeNo?: string;
}

/**
 * Populates the local SQLite cache with sample categories/items/bills so the app is
 * fully explorable without a real backend. Runs once (skipped if data already exists)
 * and writes directly with pending_sync = 0 -- this is local demo data, not something
 * that should ever be pushed to a real server via the sync queue.
 */
@Injectable({ providedIn: 'root' })
export class DemoSeedService {
  constructor(private sqlite: SqliteService) {}

  async seedIfEmpty(): Promise<void> {
    const existing = await this.sqlite.query(`SELECT COUNT(*) as cnt FROM categories`);
    if ((existing[0]?.cnt ?? 0) > 0) {
      return;
    }

    const categories = [
      { id: 'cat-notebooks', name: 'Notebooks' },
      { id: 'cat-pens', name: 'Pens & Pencils' },
      { id: 'cat-files', name: 'Files & Folders' },
      { id: 'cat-art', name: 'Art Supplies' },
    ];

    const items = [
      { id: 'item-1', name: 'A4 Notebook 200pg', categoryId: 'cat-notebooks', category: 'Notebooks', purchasePrice: 40, sellingPrice: 60, stockQty: 3, unit: 'pcs', sku: 'NB-A4-200', godownLocation: 'Rack 1, Shelf A' },
      { id: 'item-2', name: 'A5 Notebook 100pg', categoryId: 'cat-notebooks', category: 'Notebooks', purchasePrice: 25, sellingPrice: 40, stockQty: 50, unit: 'pcs', sku: 'NB-A5-100', godownLocation: 'Rack 1, Shelf B' },
      { id: 'item-3', name: 'Spiral Notebook', categoryId: 'cat-notebooks', category: 'Notebooks', purchasePrice: 30, sellingPrice: 50, stockQty: 4, unit: 'pcs', sku: 'NB-SPIRAL', godownLocation: 'Rack 1, Shelf C' },
      { id: 'item-4', name: 'Blue Ball Pen (box)', categoryId: 'cat-pens', category: 'Pens & Pencils', purchasePrice: 50, sellingPrice: 90, stockQty: 40, unit: 'box', sku: 'PEN-BLUE', godownLocation: 'Rack 2, Shelf A' },
      { id: 'item-5', name: 'Black Gel Pen (box)', categoryId: 'cat-pens', category: 'Pens & Pencils', purchasePrice: 80, sellingPrice: 150, stockQty: 2, unit: 'box', sku: 'PEN-GEL-BLK', godownLocation: 'Rack 2, Shelf A' },
      { id: 'item-6', name: 'Pencil HB (dozen)', categoryId: 'cat-pens', category: 'Pens & Pencils', purchasePrice: 30, sellingPrice: 60, stockQty: 150, unit: 'dozen', sku: 'PENCIL-HB', godownLocation: 'Rack 2, Shelf B' },
      { id: 'item-7', name: 'Eraser', categoryId: 'cat-pens', category: 'Pens & Pencils', purchasePrice: 2, sellingPrice: 5, stockQty: 80, unit: 'pcs', sku: 'ERASER-01', godownLocation: 'Rack 2, Shelf C' },
      { id: 'item-8', name: 'L-Shape File', categoryId: 'cat-files', category: 'Files & Folders', purchasePrice: 15, sellingPrice: 25, stockQty: 60, unit: 'pcs', sku: 'FILE-L', godownLocation: 'Rack 3, Shelf A' },
      { id: 'item-9', name: 'Ring Binder 2-inch', categoryId: 'cat-files', category: 'Files & Folders', purchasePrice: 45, sellingPrice: 70, stockQty: 5, unit: 'pcs', sku: 'BINDER-2IN', godownLocation: 'Rack 3, Shelf B' },
      { id: 'item-10', name: 'Plastic Folder Pack', categoryId: 'cat-files', category: 'Files & Folders', purchasePrice: 20, sellingPrice: 35, stockQty: 30, unit: 'pack', sku: 'FOLDER-PACK', godownLocation: 'Rack 3, Shelf C' },
      { id: 'item-11', name: 'Watercolor Set', categoryId: 'cat-art', category: 'Art Supplies', purchasePrice: 120, sellingPrice: 180, stockQty: 10, unit: 'box', sku: 'ART-WATERCOLOR', godownLocation: 'Godown 2 - Corner' },
      { id: 'item-12', name: 'Sketch Pad A3', categoryId: 'cat-art', category: 'Art Supplies', purchasePrice: 60, sellingPrice: 95, stockQty: 1, unit: 'pcs', sku: 'ART-SKETCHPAD', godownLocation: 'Godown 2 - Corner' },
      { id: 'item-13', name: 'Crayon Box 24pc', categoryId: 'cat-art', category: 'Art Supplies', purchasePrice: 35, sellingPrice: 55, stockQty: 25, unit: 'box', sku: 'ART-CRAYON', godownLocation: 'Godown 2 - Shelf A' },
    ];

    const bills: DemoBill[] = [
      {
        id: 'bill-demo-1', billNo: 'BILL-DEMO-1', customerName: 'Walk-in Customer', customerPhone: null, daysAgo: 0, hoursAgo: 1,
        items: [{ itemId: 'item-1', itemName: 'A4 Notebook 200pg', qty: 2, price: 60 }, { itemId: 'item-4', itemName: 'Blue Ball Pen (box)', qty: 1, price: 90 }],
        discount: 10, paymentStatus: 'paid', amountPaid: 200, paymentMethod: 'cash',
      },
      {
        id: 'bill-demo-2', billNo: 'BILL-DEMO-2', customerName: 'Walk-in Customer', customerPhone: null, daysAgo: 0, hoursAgo: 3,
        items: [{ itemId: 'item-6', itemName: 'Pencil HB (dozen)', qty: 1, price: 60 }, { itemId: 'item-7', itemName: 'Eraser', qty: 2, price: 5 }],
        discount: 0, paymentStatus: 'paid', amountPaid: 70, paymentMethod: 'upi',
      },
      {
        id: 'bill-demo-3', billNo: 'BILL-DEMO-3', customerName: 'Rajesh Kumar', customerPhone: '9876543210', daysAgo: 0, hoursAgo: 5,
        items: [{ itemId: 'item-11', itemName: 'Watercolor Set', qty: 1, price: 180 }, { itemId: 'item-13', itemName: 'Crayon Box 24pc', qty: 2, price: 55 }],
        discount: 0, paymentStatus: 'pending', amountPaid: 0, paymentMethod: null,
      },
      {
        id: 'bill-demo-4', billNo: 'BILL-DEMO-4', customerName: 'Anita Shah', customerPhone: '9822233344', daysAgo: 1,
        items: [{ itemId: 'item-9', itemName: 'Ring Binder 2-inch', qty: 1, price: 70 }, { itemId: 'item-8', itemName: 'L-Shape File', qty: 3, price: 25 }],
        discount: 5, paymentStatus: 'partial', amountPaid: 50, paymentMethod: 'cash',
      },
      {
        id: 'bill-demo-5', billNo: 'BILL-DEMO-5', customerName: 'Walk-in Customer', customerPhone: null, daysAgo: 3,
        items: [{ itemId: 'item-2', itemName: 'A5 Notebook 100pg', qty: 5, price: 40 }],
        discount: 0, paymentStatus: 'paid', amountPaid: 200, paymentMethod: 'cheque', chequeNo: '000456',
      },
      {
        id: 'bill-demo-6', billNo: 'BILL-DEMO-6', customerName: 'Vikram Singh', customerPhone: '9900011122', daysAgo: 5,
        items: [{ itemId: 'item-12', itemName: 'Sketch Pad A3', qty: 1, price: 95 }, { itemId: 'item-5', itemName: 'Black Gel Pen (box)', qty: 2, price: 150 }],
        discount: 15, paymentStatus: 'pending', amountPaid: 0, paymentMethod: null,
      },
      {
        id: 'bill-demo-7', billNo: 'BILL-DEMO-7', customerName: 'Priya Mehta', customerPhone: '9812345670', daysAgo: 10,
        items: [{ itemId: 'item-10', itemName: 'Plastic Folder Pack', qty: 4, price: 35 }, { itemId: 'item-3', itemName: 'Spiral Notebook', qty: 2, price: 50 }],
        discount: 0, paymentStatus: 'partial', amountPaid: 100, paymentMethod: 'upi',
      },
      {
        id: 'bill-demo-8', billNo: 'BILL-DEMO-8', customerName: 'Walk-in Customer', customerPhone: null, daysAgo: 20,
        items: [{ itemId: 'item-1', itemName: 'A4 Notebook 200pg', qty: 3, price: 60 }, { itemId: 'item-6', itemName: 'Pencil HB (dozen)', qty: 2, price: 60 }],
        discount: 20, paymentStatus: 'paid', amountPaid: 280, paymentMethod: 'cash',
      },
    ];

    const statements: { statement: string; values?: unknown[] }[] = [];

    for (const c of categories) {
      statements.push({
        statement: `INSERT INTO categories (id, name, pending_sync) VALUES (?, ?, 0)`,
        values: [c.id, c.name],
      });
    }

    for (const it of items) {
      statements.push({
        statement: `INSERT INTO items (id, name, category_id, category, purchase_price, selling_price, stock_qty, unit, sku, godown_location, pending_sync)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
        values: [it.id, it.name, it.categoryId, it.category, it.purchasePrice, it.sellingPrice, it.stockQty, it.unit, it.sku, it.godownLocation],
      });
    }

    for (const b of bills) {
      const total = b.items.reduce((sum, l) => sum + l.qty * l.price, 0);
      const grandTotal = Math.max(0, total - b.discount);
      const amountDue = Math.max(0, grandTotal - b.amountPaid);
      const date = new Date();
      date.setDate(date.getDate() - b.daysAgo);
      if (b.hoursAgo) date.setHours(date.getHours() - b.hoursAgo);

      statements.push({
        statement: `INSERT INTO bills (id, bill_no, customer_name, customer_phone, date, discount, total, grand_total, payment_status, amount_paid, amount_due, payment_method, cheque_no, pending_sync)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
        values: [b.id, b.billNo, b.customerName, b.customerPhone, date.toISOString(), b.discount, total, grandTotal, b.paymentStatus, b.amountPaid, amountDue, b.paymentMethod, b.chequeNo ?? null],
      });

      for (const line of b.items) {
        statements.push({
          statement: `INSERT INTO bill_items (bill_id, item_id, item_name, qty, price, subtotal) VALUES (?, ?, ?, ?, ?, ?)`,
          values: [b.id, line.itemId, line.itemName, line.qty, line.price, line.qty * line.price],
        });
      }
    }

    await this.sqlite.runBatch(statements);
  }
}
