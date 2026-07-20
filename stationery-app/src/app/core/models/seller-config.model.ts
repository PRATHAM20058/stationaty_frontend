/**
 * The shop's own business / GST identity, printed on every GST tax invoice and used to decide
 * intra- vs inter-state tax. Edited on the Settings page and persisted locally (Preferences).
 */
export interface SellerConfig {
  businessName: string;
  subtitle: string;
  address: string;
  sellerGstin: string;
  pan: string;
  mobiles: string[];
  sellerState: string;
  /** GST state code, e.g. "24" for Gujarat. Compared with the buyer's to pick intra/inter. */
  sellerStateCode: string;
  bankName: string;
  bankAccountNo: string;
  ifsc: string;
}

/** Seed values for Shree Sales Agency (used until the owner edits them in Settings). */
export const DEFAULT_SELLER_CONFIG: SellerConfig = {
  businessName: 'Shree Sales Agency',
  subtitle: 'School & Office Stationary Wholesaler',
  address: 'Old Rojgar Office Road, Becharpura, Palanpur',
  sellerGstin: '24AIVPR6534P1Z8',
  pan: 'AIVPR6534P',
  mobiles: ['92762 53587', '94275 13014'],
  sellerState: 'Gujarat',
  sellerStateCode: '24',
  bankName: 'IDBI Bank – Palanpur',
  bankAccountNo: '0323102000013767',
  ifsc: 'IBKL0000323',
};
