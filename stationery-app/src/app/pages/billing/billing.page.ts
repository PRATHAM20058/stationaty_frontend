import { Component, DestroyRef, OnInit, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import {
  IonHeader,
  IonToolbar,
  IonTitle,
  IonButtons,
  IonMenuButton,
  IonButton,
  IonBadge,
  IonIcon,
  IonContent,
  IonSearchbar,
  IonList,
  IonItem,
  IonLabel,
  IonInput,
  IonSegment,
  IonSegmentButton,
  IonChip,
  IonToggle,
  IonSelect,
  IonSelectOption,
  ModalController,
  ToastController,
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { addOutline, removeOutline, trashOutline, timeOutline, pricetagOutline, cartOutline, qrCodeOutline } from 'ionicons/icons';
import { ItemService } from '../../core/services/item.service';
import { BillingService } from '../../core/services/billing.service';
import { CategoryService } from '../../core/services/category.service';
import { SellerConfigService } from '../../core/services/seller-config.service';
import { Item, GST_PERCENT_OPTIONS } from '../../core/models/item.model';
import { Category } from '../../core/models/category.model';
import { BillItem, PaymentMethod, PaymentStatus } from '../../core/models/bill.model';
import { SellerConfig, DEFAULT_SELLER_CONFIG } from '../../core/models/seller-config.model';
import { calcGstBill, GstBillResult } from '../../core/utils/gst.util';
import { EnterNextDirective } from '../../shared/directives/enter-next.directive';
import { BarcodeScannerModalComponent } from '../../shared/components/barcode-scanner-modal/barcode-scanner-modal.component';

type DiscountMode = 'amount' | 'percent';

/** A cart line plus the UI-only state for its per-item discount editor. */
interface CartLine extends Omit<BillItem, 'gstPercent'> {
  discountMode: DiscountMode;
  /** Raw value the user typed -- rupees if discountMode is 'amount', a percent number if 'percent'.
      Starts empty (null) so the user never has to clear a prefilled 0. */
  discountInput: number | null;
  discountOpen: boolean;
  /** Per-line GST rate; starts from the item's saved rate, null until chosen. */
  gstPercent: number | null;
  hsnCode: string | null;
}

@Component({
  selector: 'app-billing',
  standalone: true,
  templateUrl: './billing.page.html',
  styleUrls: ['./billing.page.scss'],
  imports: [
    CommonModule,
    FormsModule,
    IonHeader,
    IonToolbar,
    IonTitle,
    IonButtons,
    IonMenuButton,
    IonButton,
    IonBadge,
    IonIcon,
    IonContent,
    IonSearchbar,
    IonList,
    IonItem,
    IonLabel,
    IonInput,
    IonSegment,
    IonSegmentButton,
    IonChip,
    IonToggle,
    IonSelect,
    IonSelectOption,
    EnterNextDirective,
  ],
})
export class BillingPage implements OnInit {
  searchTerm = '';
  searchResults: Item[] = [];
  cart: CartLine[] = [];

  /** Categories used to browse-and-add items without typing a search. */
  categories: Category[] = [];
  selectedCategoryId: string | null = null;
  categoryItems: Item[] = [];

  customerName = '';
  customerPhone = '';

  // --- GST invoice state ---
  isGstInvoice = false;
  buyerGstin = '';
  buyerState = '';
  buyerStateCode = '';
  gstOptions = GST_PERCENT_OPTIONS;
  seller: SellerConfig = DEFAULT_SELLER_CONFIG;

  paymentStatus: PaymentStatus = 'paid';
  paymentMethod: PaymentMethod = 'cash';
  /** Empty until the user types — no prefilled 0 to clear. */
  partialAmountReceived: number | null = null;
  /** Only used when paymentMethod is 'cheque'; optional since it may not be known at billing time. */
  chequeNo = '';

  pendingCount = 0;
  saving = false;

  private destroyRef = inject(DestroyRef);

  constructor(
    private itemService: ItemService,
    private billingService: BillingService,
    private categoryService: CategoryService,
    private sellerConfig: SellerConfigService,
    private router: Router,
    private toastController: ToastController,
    private modalController: ModalController,
  ) {
    addIcons({ addOutline, removeOutline, trashOutline, timeOutline, pricetagOutline, cartOutline, qrCodeOutline });
  }

  async ngOnInit(): Promise<void> {
    this.seller = await this.sellerConfig.get();
    await this.refreshPendingCount();
    await this.loadCategories();
    // Recording a payment / marking a bill paid happens on the pending-bills and bill-detail
    // pages, which open as top-level routes over the tabs shell -- so this tab's
    // ionViewWillEnter does NOT fire on return. Subscribe to bill changes so the "Pending"
    // badge count stays accurate.
    this.billingService.changes$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => this.refreshPendingCount());
  }

  async ionViewWillEnter(): Promise<void> {
    // Pick up any edits made on the Settings page (GSTIN, state code, etc.).
    this.seller = await this.sellerConfig.get();
    await this.refreshPendingCount();
    await this.loadCategories();
  }

  private async loadCategories(): Promise<void> {
    this.categories = await this.categoryService.list();
  }

  private async refreshPendingCount(): Promise<void> {
    const summary = await this.billingService.getPendingSummary();
    this.pendingCount = summary.count;
  }

  async onSearch(term: string | null | undefined): Promise<void> {
    this.searchTerm = term ?? '';
    if (!this.searchTerm) {
      this.searchResults = [];
      return;
    }
    // Searching and category browsing are mutually exclusive views.
    this.clearCategory();
    this.searchResults = await this.itemService.list({ search: this.searchTerm });
  }

  async scanBarcode(): Promise<void> {
    const modal = await this.modalController.create({
      component: BarcodeScannerModalComponent,
      cssClass: 'barcode-scanner-modal',
      showBackdrop: false,
    });
    await modal.present();
    const { data, role } = await modal.onWillDismiss();
    if (role === 'scanned' && data?.barcode) {
      await this.addByCode(data.barcode);
    }
  }

  /** Looks up a scanned SKU, shows its detail via the normal search results, and auto-adds an exact match to the cart. */
  private async addByCode(code: string): Promise<void> {
    await this.onSearch(code);
    const match = this.searchResults.find((i) => i.sku === code);
    if (match) {
      this.addToCart(match);
      const toast = await this.toastController.create({ message: `Added ${match.name} to cart`, duration: 1500, color: 'success' });
      await toast.present();
    } else if (this.searchResults.length === 0) {
      const toast = await this.toastController.create({ message: `No item found for code ${code}`, duration: 2000, color: 'warning' });
      await toast.present();
    }
  }

  /** Toggle a category open/closed; when open, lists that category's items to tap-add. */
  async selectCategory(cat: Category): Promise<void> {
    if (this.selectedCategoryId === cat.id) {
      this.clearCategory();
      return;
    }
    this.searchTerm = '';
    this.searchResults = [];
    this.selectedCategoryId = cat.id;
    this.categoryItems = await this.itemService.list({ categoryId: cat.id });
  }

  clearCategory(): void {
    this.selectedCategoryId = null;
    this.categoryItems = [];
  }

  get selectedCategoryName(): string {
    return this.categories.find((c) => c.id === this.selectedCategoryId)?.name ?? '';
  }

  addToCart(item: Item): void {
    const existing = this.cart.find((l) => l.itemId === item.id);
    if (existing) {
      existing.qty += 1;
      this.recalcLine(existing);
    } else {
      this.cart.push({
        itemId: item.id,
        itemName: item.name,
        qty: 1,
        price: item.sellingPrice,
        subtotal: item.sellingPrice,
        discount: 0,
        discountMode: 'amount',
        discountInput: null,
        discountOpen: false,
        gstPercent: item.gstPercent ?? null,
        hsnCode: item.hsnCode ?? null,
      });
    }
    this.searchTerm = '';
    this.searchResults = [];
  }

  incQty(line: CartLine): void {
    line.qty += 1;
    this.recalcLine(line);
  }

  decQty(line: CartLine): void {
    if (line.qty <= 1) {
      this.removeLine(line);
      return;
    }
    line.qty -= 1;
    this.recalcLine(line);
  }

  /** Lets the cashier type a quantity directly instead of tapping +/- repeatedly for large amounts. */
  onQtyInput(line: CartLine, raw: string | number | null | undefined): void {
    const parsed = Math.floor(Number(raw));
    line.qty = Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
    this.recalcLine(line);
  }

  removeLine(line: CartLine): void {
    this.cart = this.cart.filter((l) => l.itemId !== line.itemId);
  }

  toggleDiscount(line: CartLine): void {
    line.discountOpen = !line.discountOpen;
  }

  /** Recomputes a line's gross subtotal and discount amount from its qty/price/discount input. */
  recalcLine(line: CartLine): void {
    line.subtotal = line.qty * line.price;
    const raw = line.discountInput || 0;
    const rawDiscount = line.discountMode === 'percent' ? (line.subtotal * raw) / 100 : raw;
    line.discount = Math.min(line.subtotal, Math.max(0, rawDiscount));
  }

  lineNetTotal(line: CartLine): number {
    return line.subtotal - line.discount;
  }

  get total(): number {
    return this.cart.reduce((sum, l) => sum + l.subtotal, 0);
  }

  get totalDiscount(): number {
    return this.cart.reduce((sum, l) => sum + l.discount, 0);
  }

  /** Live GST computation for the current cart, using the loaded seller config. */
  get gst(): GstBillResult {
    return calcGstBill(
      {
        isGstInvoice: this.isGstInvoice,
        // Mirror generateBill's default so live totals match the saved bill (blank => intra-state).
        buyerStateCode: this.buyerStateCode.trim() || '24',
        items: this.cart.map((l) => ({ subtotal: l.subtotal, discount: l.discount, gstPercent: l.gstPercent })),
      },
      this.seller,
    );
  }

  get grandTotal(): number {
    if (this.isGstInvoice) return this.gst.grandTotal;
    return Math.max(0, this.total - this.totalDiscount);
  }

  /** True while GST mode is on but some cart line still has no GST rate chosen. */
  get hasUnsetGst(): boolean {
    return this.isGstInvoice && this.cart.some((l) => l.gstPercent === null || l.gstPercent === undefined);
  }

  get amountPaid(): number {
    if (this.paymentStatus === 'paid') return this.grandTotal;
    if (this.paymentStatus === 'pending') return 0;
    return Math.min(this.grandTotal, this.partialAmountReceived || 0);
  }

  get amountDue(): number {
    return Math.max(0, this.grandTotal - this.amountPaid);
  }

  get canGenerate(): boolean {
    if (this.cart.length === 0) return false;
    if (this.paymentStatus !== 'paid' && !this.customerName.trim()) return false;
    if (this.paymentStatus === 'partial' && (this.partialAmountReceived ?? 0) <= 0) return false;
    if (this.hasUnsetGst) return false;
    return true;
  }

  async generateBill(): Promise<void> {
    if (!this.canGenerate || this.saving) return;
    this.saving = true;
    try {
      const items: BillItem[] = this.cart.map((l) => ({
        itemId: l.itemId,
        itemName: l.itemName,
        qty: l.qty,
        price: l.price,
        subtotal: l.subtotal,
        discount: l.discount,
        hsnCode: l.hsnCode,
        gstPercent: l.gstPercent ?? 0,
      }));

      const bill = await this.billingService.createBill({
        customerName: this.customerName.trim() || 'Walk-in Customer',
        customerPhone: this.customerPhone.trim() || undefined,
        items,
        discount: this.totalDiscount,
        paymentStatus: this.paymentStatus,
        amountPaid: this.amountPaid,
        amountDue: this.amountDue,
        paymentMethod: this.paymentStatus === 'pending' ? null : this.paymentMethod,
        chequeNo: this.paymentMethod === 'cheque' ? this.chequeNo.trim() || undefined : undefined,
        isGstInvoice: this.isGstInvoice,
        buyerGstin: this.isGstInvoice ? this.buyerGstin.trim() || null : null,
        // Default a blank buyer state/code to the seller's own (Gujarat / 24) => intra-state.
        buyerState: this.isGstInvoice ? this.buyerState.trim() || 'Gujarat' : null,
        buyerStateCode: this.isGstInvoice ? this.buyerStateCode.trim() || '24' : null,
      });

      const toast = await this.toastController.create({ message: `Bill ${bill.billNo} generated`, duration: 1800, color: 'success' });
      await toast.present();

      this.resetForm();
      this.router.navigateByUrl(`/bills/${bill.id}`);
    } finally {
      this.saving = false;
    }
  }

  private resetForm(): void {
    this.cart = [];
    this.customerName = '';
    this.customerPhone = '';
    this.paymentStatus = 'paid';
    this.paymentMethod = 'cash';
    this.partialAmountReceived = null;
    this.chequeNo = '';
    this.isGstInvoice = false;
    this.buyerGstin = '';
    this.buyerState = '';
    this.buyerStateCode = '';
  }

  goToPendingBills(): void {
    this.router.navigateByUrl('/pending-bills');
  }
}
