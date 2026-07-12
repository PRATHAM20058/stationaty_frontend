import { Injectable } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { Share } from '@capacitor/share';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Bill } from '../models/bill.model';
import { environment } from '../../../environments/environment';

@Injectable({ providedIn: 'root' })
export class PdfService {
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

  /** Opens the native share sheet (Android) or triggers a browser download (web) for the bill PDF. */
  async shareBillPdf(bill: Bill): Promise<void> {
    const pdfMake = await this.pdfMakePromise;
    const docDefinition = this.buildDocDefinition(bill);
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
