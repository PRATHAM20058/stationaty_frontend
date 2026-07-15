import { Injectable } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { Share } from '@capacitor/share';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { ItemService } from './item.service';
import { CategoryService } from './category.service';
import { ItemUnit, GST_PERCENT_OPTIONS } from '../models/item.model';

/** The canonical column headers, in order — used for the downloadable template and error hints. */
export const TEMPLATE_HEADERS = [
  'Name', 'Category', 'Purchase Price', 'Selling Price', 'Stock Qty',
  'Unit', 'SKU', 'Godown Location', 'HSN Code', 'GST %',
] as const;

export interface ImportRowError {
  row: number;
  message: string;
}

export interface ImportResult {
  created: number;
  skipped: number;
  errors: ImportRowError[];
}

const UNITS: ItemUnit[] = ['pcs', 'box', 'dozen', 'pack'];
const GST_ALLOWED = new Set<number>(GST_PERCENT_OPTIONS as readonly number[]);

/** Collapse a spreadsheet header to a comparable key: lowercase, drop spaces/underscores/%/dots. */
function normalizeHeader(h: string): string {
  return String(h).toLowerCase().replace(/[\s_%.()-]/g, '');
}

/** Normalized header -> Item field. Accepts a few friendly aliases for each column. */
const HEADER_MAP: Record<string, string> = {
  name: 'name', itemname: 'name', item: 'name', product: 'name', productname: 'name',
  category: 'category', categoryname: 'category',
  purchaseprice: 'purchasePrice', purchase: 'purchasePrice', costprice: 'purchasePrice', cost: 'purchasePrice', buyprice: 'purchasePrice',
  sellingprice: 'sellingPrice', selling: 'sellingPrice', price: 'sellingPrice', saleprice: 'sellingPrice', mrp: 'sellingPrice', rate: 'sellingPrice',
  stockqty: 'stockQty', stock: 'stockQty', qty: 'stockQty', quantity: 'stockQty', stockquantity: 'stockQty',
  unit: 'unit', uom: 'unit',
  sku: 'sku', barcode: 'sku', code: 'sku',
  godownlocation: 'godownLocation', godown: 'godownLocation', location: 'godownLocation', rack: 'godownLocation',
  hsncode: 'hsnCode', hsn: 'hsnCode', hsnsac: 'hsnCode',
  gst: 'gstPercent', gstpercent: 'gstPercent', gstrate: 'gstPercent', tax: 'gstPercent', taxpercent: 'gstPercent',
};

/**
 * Parses an Excel workbook of items and creates them through the normal ItemService path
 * (local SQLite + sync queue), so imported items sync to the backend and work offline exactly
 * like items added from the form. Frontend-only; no new endpoints.
 */
@Injectable({ providedIn: 'root' })
export class ItemImportService {
  constructor(
    private itemService: ItemService,
    private categoryService: CategoryService,
  ) {}

  async importFromArrayBuffer(buf: ArrayBuffer): Promise<ImportResult> {
    // Lazy-load SheetJS so it ships as its own chunk (keeps the initial bundle small).
    const XLSX: any = await import('xlsx');

    const wb = XLSX.read(buf, { type: 'array' });
    const sheetName = wb.SheetNames[0];
    if (!sheetName) return { created: 0, skipped: 0, errors: [{ row: 0, message: 'The file has no sheets.' }] };

    const rows: any[] = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: '' });
    if (rows.length === 0) return { created: 0, skipped: 0, errors: [{ row: 0, message: 'No data rows found in the first sheet.' }] };

    // Guard: if the file's header row isn't recognized (wrong format / a title row on top / a
    // renamed "Name" column), fail with a clear hint instead of reporting every row as "Missing Name".
    const recognized = new Set(
      Object.keys(rows[0]).map((k) => HEADER_MAP[normalizeHeader(k)]).filter(Boolean),
    );
    if (!recognized.has('name')) {
      return {
        created: 0,
        skipped: 0,
        errors: [{
          row: 0,
          message:
            'Could not find a "Name" column. The first row must be the column headers. Expected: ' +
            TEMPLATE_HEADERS.join(', ') +
            '. Use "Download template" for the exact format.',
        }],
      };
    }

    // Existing categories: name (lowercased) -> id. New category names are created on demand.
    const existing = await this.categoryService.list();
    const catByName = new Map<string, string>();
    for (const c of existing) catByName.set(c.name.trim().toLowerCase(), c.id);

    const result: ImportResult = { created: 0, skipped: 0, errors: [] };
    let rowNum = 1; // header occupies sheet row 1, so the first data row is row 2

    for (const raw of rows) {
      rowNum++;

      // Remap the row's headers to canonical field names.
      const rec: Record<string, any> = {};
      for (const key of Object.keys(raw)) {
        const field = HEADER_MAP[normalizeHeader(key)];
        if (field) rec[field] = raw[key];
      }

      const name = String(rec['name'] ?? '').trim();
      if (!name) {
        result.skipped++;
        result.errors.push({ row: rowNum, message: 'Missing Name' });
        continue;
      }

      // Unit (default pcs).
      let unit = String(rec['unit'] ?? '').trim().toLowerCase() as ItemUnit;
      if (!unit) unit = 'pcs';
      if (!UNITS.includes(unit)) {
        result.skipped++;
        result.errors.push({ row: rowNum, message: `Invalid Unit "${rec['unit']}" (use pcs / box / dozen / pack)` });
        continue;
      }

      // GST % (blank -> null; otherwise must be one of the allowed rates).
      let gstPercent: number | null = null;
      const gstRaw = String(rec['gstPercent'] ?? '').trim().replace('%', '');
      if (gstRaw) {
        const g = Number(gstRaw);
        if (!Number.isFinite(g) || !GST_ALLOWED.has(g)) {
          result.skipped++;
          result.errors.push({ row: rowNum, message: `Invalid GST "${rec['gstPercent']}" (use 0 / 5 / 12 / 18 / 28)` });
          continue;
        }
        gstPercent = g;
      }

      // Category: reuse an existing one by name, else create it. Blank is allowed (no category).
      let categoryId = '';
      let categoryName: string | undefined;
      const catRaw = String(rec['category'] ?? '').trim();
      if (catRaw) {
        const key = catRaw.toLowerCase();
        let id = catByName.get(key);
        if (!id) {
          const created = await this.categoryService.create(catRaw);
          id = created.id;
          catByName.set(key, id);
        }
        categoryId = id;
        categoryName = catRaw;
      }

      try {
        await this.itemService.create({
          name,
          categoryId,
          category: categoryName,
          purchasePrice: this.num(rec['purchasePrice']),
          sellingPrice: this.num(rec['sellingPrice']),
          stockQty: this.num(rec['stockQty']),
          unit,
          sku: String(rec['sku'] ?? '').trim() || undefined,
          godownLocation: String(rec['godownLocation'] ?? '').trim() || undefined,
          hsnCode: String(rec['hsnCode'] ?? '').trim() || null,
          gstPercent,
        });
        result.created++;
      } catch (e: any) {
        result.skipped++;
        result.errors.push({ row: rowNum, message: 'Failed to save: ' + (e?.message ?? e) });
      }
    }

    return result;
  }

  /**
   * Generates a ready-to-fill `.xlsx` with the exact headers plus one example row and hands it to
   * the user — a browser download on web, or the native share sheet on Android/iOS.
   */
  async downloadTemplate(): Promise<void> {
    const XLSX: any = await import('xlsx');

    const example = {
      Name: 'A4 Notebook',
      Category: 'Notebooks',
      'Purchase Price': 30,
      'Selling Price': 50,
      'Stock Qty': 40,
      Unit: 'pcs',
      SKU: 'NB-A4',
      'Godown Location': 'Rack 2',
      'HSN Code': '4820',
      'GST %': 12,
    };
    const ws = XLSX.utils.json_to_sheet([example], { header: TEMPLATE_HEADERS as unknown as string[] });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Items');

    const fileName = 'items-import-template.xlsx';
    if (Capacitor.getPlatform() === 'web') {
      XLSX.writeFile(wb, fileName); // triggers a browser download
      return;
    }
    // Native: write to cache, then open the share sheet (same pattern as PdfService).
    const base64: string = XLSX.write(wb, { type: 'base64', bookType: 'xlsx' });
    const result = await Filesystem.writeFile({ path: fileName, data: base64, directory: Directory.Cache });
    await Share.share({ title: 'Items import template', url: result.uri });
  }

  private num(v: any): number {
    const n = Number(String(v ?? '').trim());
    return Number.isFinite(n) ? n : 0;
  }
}
