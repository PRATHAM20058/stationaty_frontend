import { calcGstBill, numberToWordsIndian, round2, GstBillInput } from './gst.util';

const seller = { sellerStateCode: '24' };

// The acceptance sample from the spec: intra-state (buyer code 24), GST 18%, three lines whose
// discount-net (taxable) values are 1305.08, 1949.15 and 25.42.
const sampleLines = [
  { subtotal: 1305.08, discount: 0, gstPercent: 18 },
  { subtotal: 1949.15, discount: 0, gstPercent: 18 },
  { subtotal: 25.42, discount: 0, gstPercent: 18 },
];

describe('round2', () => {
  it('rounds to two decimals without float drift', () => {
    expect(round2(117.4572)).toBe(117.46);
    expect(round2(2.2878)).toBe(2.29);
    expect(round2(0.1 + 0.2)).toBe(0.3);
  });
});

describe('calcGstBill — acceptance (intra-state, 18%)', () => {
  const result = calcGstBill({ isGstInvoice: true, buyerStateCode: '24', items: sampleLines }, seller);

  it('classifies as intra-state', () => {
    expect(result.gstType).toBe('intra');
  });

  it('reproduces the expected totals', () => {
    expect(result.taxableAmount).toBe(3279.65);
    expect(result.sgstTotal).toBe(295.17);
    expect(result.cgstTotal).toBe(295.17);
    expect(result.igstTotal).toBe(0);
    expect(result.roundOff).toBe(0.01);
    expect(result.grandTotal).toBe(3870.0);
  });

  it('renders the amount in words', () => {
    expect(result.amountInWords).toBe('Three thousand Eight hundred Seventy Rs only');
  });

  it('splits each line into equal SGST and CGST', () => {
    expect(result.lines[0].sgst).toBe(117.46);
    expect(result.lines[0].cgst).toBe(117.46);
    expect(result.lines[0].igst).toBe(0);
  });
});

describe('calcGstBill — inter-state', () => {
  const result = calcGstBill({ isGstInvoice: true, buyerStateCode: '27', items: sampleLines }, seller);

  it('classifies as inter-state and charges IGST only', () => {
    expect(result.gstType).toBe('inter');
    expect(result.sgstTotal).toBe(0);
    expect(result.cgstTotal).toBe(0);
    expect(result.igstTotal).toBe(590.34);
    expect(result.grandTotal).toBe(3870.0);
    expect(result.roundOff).toBe(0.01);
  });

  it('treats a missing buyer state code as inter-state', () => {
    const noBuyer = calcGstBill({ isGstInvoice: true, buyerStateCode: null, items: sampleLines }, seller);
    expect(noBuyer.gstType).toBe('inter');
  });
});

describe('calcGstBill — non-GST regression', () => {
  it('produces grandTotal === total - discount with all tax fields 0', () => {
    const bill: GstBillInput = {
      isGstInvoice: false,
      items: [
        { subtotal: 100, discount: 10, gstPercent: 18 },
        { subtotal: 50, discount: 0, gstPercent: 5 },
      ],
    };
    const total = bill.items.reduce((s, l) => s + l.subtotal, 0); // 150
    const discount = bill.items.reduce((s, l) => s + l.discount, 0); // 10

    const result = calcGstBill(bill, seller);

    expect(result.gstType).toBe('none');
    expect(result.grandTotal).toBe(total - discount); // 140
    expect(result.sgstTotal).toBe(0);
    expect(result.cgstTotal).toBe(0);
    expect(result.igstTotal).toBe(0);
    expect(result.roundOff).toBe(0);
    result.lines.forEach((l) => {
      expect(l.sgst).toBe(0);
      expect(l.cgst).toBe(0);
      expect(l.igst).toBe(0);
    });
  });
});

describe('numberToWordsIndian', () => {
  it('handles the acceptance value', () => {
    expect(numberToWordsIndian(3870)).toBe('Three thousand Eight hundred Seventy Rs only');
  });

  it('handles zero and small numbers', () => {
    expect(numberToWordsIndian(0)).toBe('Zero Rs only');
    expect(numberToWordsIndian(100)).toBe('One hundred Rs only');
  });

  it('uses Indian lakh/crore grouping', () => {
    expect(numberToWordsIndian(125000)).toBe('One lakh Twenty Five thousand Rs only');
    expect(numberToWordsIndian(10000000)).toBe('One crore Rs only');
  });

  it('appends paise when non-zero', () => {
    expect(numberToWordsIndian(1234.5)).toBe('One thousand Two hundred Thirty Four Rs and Fifty Paise only');
  });
});
