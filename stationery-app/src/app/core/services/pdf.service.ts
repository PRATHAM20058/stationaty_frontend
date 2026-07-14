import { Injectable } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { Share } from '@capacitor/share';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Bill } from '../models/bill.model';
import { SellerConfig } from '../models/seller-config.model';
import { SellerConfigService } from './seller-config.service';
import { numberToWordsIndian } from '../utils/gst.util';
import { environment } from '../../../environments/environment';

function money(n: number | undefined | null): string {
  return (Number(n) || 0).toFixed(2);
}

@Injectable({ providedIn: 'root' })
export class PdfService {
  constructor(private sellerConfig: SellerConfigService) {}

  private pdfMakePromise = import('pdfmake/build/pdfmake').then(async (pdfMakeModule) => {
    const pdfMake = (pdfMakeModule as any).default ?? pdfMakeModule;
    const fontsModule = await import('pdfmake/build/vfs_fonts');
    const vfs = (fontsModule as any).default ?? fontsModule;
    pdfMake.addVirtualFileSystem(vfs);
    return pdfMake;
  });

  private buildDocDefinition(bill: Bill) {
    const statusLabel = bill.paymentStatus === 'paid' ? 'PAID' : `DUE: ₹${bill.amountDue.toFixed(2)}`;
    const statusColor = bill.paymentStatus === 'paid' ? 'green' : 'red';

    return {
      content: [
        { text: environment.company.name, style: 'header' },
        { text: `GSTIN: ${environment.company.gstNo}`, style: 'company' },
        { text: `Bill No: ${bill.billNo}`, margin: [0, 8, 0, 0] as [number, number, number, number] },
        { text: `Date: ${new Date(bill.date).toLocaleString()}` },
        { text: `Customer: ${bill.customerName}${bill.customerPhone ? ' (' + bill.customerPhone + ')' : ''}` },
        {
          text: statusLabel,
          style: 'status',
          color: statusColor,
          margin: [0, 10, 0, 10] as [number, number, number, number],
        },
        {
          table: {
            headerRows: 1,
            widths: ['*', 'auto', 'auto', 'auto', 'auto'],
            body: [
              ['Item', 'Qty', 'Price', 'Discount', 'Total'],
              ...bill.items.map((it) => [
                it.itemName,
                String(it.qty),
                it.price.toFixed(2),
                it.discount > 0 ? it.discount.toFixed(2) : '-',
                (it.subtotal - it.discount).toFixed(2),
              ]),
            ],
          },
        },
        {
          margin: [0, 10, 0, 0] as [number, number, number, number],
          columns: [
            { width: '*', text: '' },
            {
              width: 'auto',
              table: {
                body: [
                  ['Total', bill.total.toFixed(2)],
                  ['Discount', bill.discount.toFixed(2)],
                  ['Grand Total', bill.grandTotal.toFixed(2)],
                  ['Amount Paid', bill.amountPaid.toFixed(2)],
                  ['Amount Due', bill.amountDue.toFixed(2)],
                ],
              },
              layout: 'noBorders',
            },
          ],
        },
        bill.paymentMethod ? { text: `Payment method: ${bill.paymentMethod.toUpperCase()}`, margin: [0, 10, 0, 0] as [number, number, number, number] } : {},
      ],
      styles: {
        header: { fontSize: 20, bold: true },
        company: { fontSize: 11, color: 'gray', margin: [0, 2, 0, 0] as [number, number, number, number] },
        status: { fontSize: 16, bold: true },
      },
    };
  }

  /**
   * Bordered A4 portrait GST tax invoice matching the shop's paper format. Used only when
   * bill.isGstInvoice; legacy bills keep buildDocDefinition().
   */
  private buildGstDocDefinition(bill: Bill, seller: SellerConfig) {
    const isInter = bill.gstType === 'inter';
    const amountWords = bill.amountInWords || numberToWordsIndian(bill.grandTotal);
    const border0 = [false, false, false, false];

    // --- Items table (columns differ for intra vs inter state) ---
    const header = isInter
      ? ['Sr.', 'Description of Goods', 'HSN', 'Qty', 'Rate', 'Amount', 'GST%', 'IGST Amt', 'Total']
      : ['Sr.', 'Description of Goods', 'HSN', 'Qty', 'Rate', 'Amount', 'GST%', 'SGST Amt', 'CGST Amt', 'Total'];
    const widths = isInter
      ? [18, '*', 38, 28, 42, 50, 28, 50, 55]
      : [18, '*', 34, 26, 38, 46, 26, 44, 44, 48];

    const headerRow = header.map((h) => ({ text: h, style: 'th' }));
    const itemRows = bill.items.map((line, i) => {
      const taxable = line.taxableValue ?? line.subtotal - line.discount;
      const lineTotal = taxable + (line.sgst ?? 0) + (line.cgst ?? 0) + (line.igst ?? 0);
      const common = [
        { text: String(i + 1), style: 'td', alignment: 'center' },
        { text: line.itemName, style: 'td' },
        { text: line.hsnCode ?? '', style: 'td', alignment: 'center' },
        { text: String(line.qty), style: 'td', alignment: 'center' },
        { text: money(line.price), style: 'td', alignment: 'right' },
        { text: money(line.subtotal), style: 'td', alignment: 'right' },
        { text: `${line.gstPercent ?? 0}%`, style: 'td', alignment: 'center' },
      ];
      const taxCells = isInter
        ? [{ text: money(line.igst), style: 'td', alignment: 'right' }]
        : [
            { text: money(line.sgst), style: 'td', alignment: 'right' },
            { text: money(line.cgst), style: 'td', alignment: 'right' },
          ];
      return [...common, ...taxCells, { text: money(lineTotal), style: 'td', alignment: 'right' }];
    });

    // Pad with empty ruled rows so short invoices still fill the page like the paper form.
    const padCount = Math.max(0, 8 - bill.items.length);
    const emptyRows = Array.from({ length: padCount }, () =>
      header.map(() => ({ text: ' ', style: 'td' })),
    );

    // --- Totals ledger (right side) ---
    const ledger: any[] = [
      ['Total Amount Before Tax', money(bill.taxableAmount)],
      ...(isInter ? [['Add: IGST', money(bill.igstTotal)]] : [['Add: SGST', money(bill.sgstTotal)], ['Add: CGST', money(bill.cgstTotal)]]),
      ['Round Off', (bill.roundOff ?? 0) >= 0 ? `+${money(bill.roundOff)}` : money(bill.roundOff)],
    ];

    return {
      pageSize: 'A4',
      pageMargins: [24, 24, 24, 24] as [number, number, number, number],
      content: [
        // Top band
        {
          table: {
            widths: [150, '*', 150],
            body: [
              [
                { text: `GSTIN: ${seller.sellerGstin}\nPAN: ${seller.pan}`, style: 'bandSmall' },
                {
                  stack: [
                    { text: '|| Shree Ganeshay Namah ||', style: 'divine' },
                    { text: 'CASH · CREDIT MEMO', style: 'memoKind' },
                    { text: seller.businessName, style: 'bizName' },
                    { text: seller.subtitle, style: 'bizSub' },
                    { text: seller.address, style: 'bizSub' },
                  ],
                  alignment: 'center',
                },
                { text: `TAX INVOICE\n\nMob: ${seller.mobiles.join(', ')}`, style: 'bandSmall', alignment: 'right' },
              ],
            ],
          },
        },
        // Buyer + invoice meta
        {
          table: {
            widths: ['*', 'auto'],
            body: [
              [
                {
                  stack: [
                    { text: 'To,', style: 'metaLabel' },
                    { text: bill.customerName, style: 'metaValueBold' },
                    ...(bill.customerPhone ? [{ text: `Ph: ${bill.customerPhone}`, style: 'metaValue' }] : []),
                    { text: `GSTIN: ${bill.buyerGstin ?? '—'}`, style: 'metaValue' },
                    { text: `State: ${bill.buyerState ?? '—'}   Code: ${bill.buyerStateCode ?? '—'}`, style: 'metaValue' },
                  ],
                },
                {
                  stack: [
                    { text: `Invoice No.: ${bill.billNo}`, style: 'metaValue' },
                    { text: `Date: ${new Date(bill.date).toLocaleDateString()}`, style: 'metaValue' },
                    { text: `State: ${seller.sellerState}   Code: ${seller.sellerStateCode}`, style: 'metaValue' },
                  ],
                },
              ],
            ],
          },
        },
        // Items
        {
          table: { headerRows: 1, widths, body: [headerRow, ...itemRows, ...emptyRows] },
        },
        // Words + bank (left) | totals ledger (right)
        {
          table: {
            widths: ['*', 'auto'],
            body: [
              [
                {
                  stack: [
                    { text: 'Amount in Words:', style: 'metaLabel' },
                    { text: amountWords, style: 'metaValueBold' },
                    { text: '\nBank Details', style: 'metaLabel' },
                    { text: `${seller.bankName}\nA/c No.: ${seller.bankAccountNo}\nIFSC: ${seller.ifsc}`, style: 'metaValue' },
                  ],
                },
                {
                  table: {
                    widths: ['*', 60],
                    body: [
                      ...ledger.map((r) => [
                        { text: r[0], style: 'ledgerLabel' },
                        { text: r[1], style: 'ledgerValue', alignment: 'right' },
                      ]),
                      [
                        { text: 'Total Value After Tax', style: 'ledgerTotalLabel' },
                        { text: money(bill.grandTotal), style: 'ledgerTotalValue', alignment: 'right' },
                      ],
                    ],
                  },
                  layout: 'noBorders',
                },
              ],
            ],
          },
        },
        // Footer
        {
          margin: [0, 10, 0, 0] as [number, number, number, number],
          table: {
            widths: ['*'],
            body: [
              [
                {
                  border: border0,
                  stack: [
                    { text: 'Declaration: We declare that this invoice shows the actual price of the goods described and that all particulars are true and correct.', style: 'footer' },
                    { text: 'Goods once sold will not be taken back.', style: 'footer' },
                    { text: 'Subject to Palanpur Jurisdiction only.', style: 'footer' },
                    { text: `\nFor, ${seller.businessName}\n\n\nAuthorised Signatory`, style: 'signatory', alignment: 'right' },
                  ],
                },
              ],
            ],
          },
        },
      ],
      styles: {
        bandSmall: { fontSize: 8 },
        divine: { fontSize: 8, italics: true },
        memoKind: { fontSize: 7, color: 'gray' },
        bizName: { fontSize: 18, bold: true, margin: [0, 2, 0, 0] as [number, number, number, number] },
        bizSub: { fontSize: 8 },
        metaLabel: { fontSize: 8, color: 'gray' },
        metaValue: { fontSize: 9 },
        metaValueBold: { fontSize: 10, bold: true },
        th: { fontSize: 8, bold: true, fillColor: '#eeeeee', alignment: 'center' },
        td: { fontSize: 8 },
        ledgerLabel: { fontSize: 9 },
        ledgerValue: { fontSize: 9 },
        ledgerTotalLabel: { fontSize: 10, bold: true },
        ledgerTotalValue: { fontSize: 10, bold: true },
        footer: { fontSize: 7, color: 'gray' },
        signatory: { fontSize: 9, bold: true },
      },
    };
  }

  /** Opens the native share sheet (Android) or triggers a browser download (web) for the bill PDF. */
  async shareBillPdf(bill: Bill): Promise<void> {
    const pdfMake = await this.pdfMakePromise;
    const docDefinition = bill.isGstInvoice
      ? this.buildGstDocDefinition(bill, await this.sellerConfig.get())
      : this.buildDocDefinition(bill);
    const pdfDoc = pdfMake.createPdf(docDefinition);

    if (Capacitor.getPlatform() === 'web') {
      await pdfDoc.download(`${bill.billNo}.pdf`);
      return;
    }

    const base64: string = await pdfDoc.getBase64();
    const fileName = `${bill.billNo}.pdf`;
    const result = await Filesystem.writeFile({ path: fileName, data: base64, directory: Directory.Cache });
    await Share.share({ title: bill.billNo, url: result.uri });
  }
}
