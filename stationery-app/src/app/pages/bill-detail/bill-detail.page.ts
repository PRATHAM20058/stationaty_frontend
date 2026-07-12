import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import {
  IonHeader,
  IonToolbar,
  IonTitle,
  IonButtons,
  IonBackButton,
  IonButton,
  IonIcon,
  IonContent,
  IonBadge,
  IonList,
  IonItem,
  IonLabel,
  IonSkeletonText,
  ModalController,
  ToastController,
  AlertController,
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  shareOutline,
  checkmarkCircleOutline,
  cashOutline,
  createOutline,
  trashOutline,
  addOutline,
  removeOutline,
} from 'ionicons/icons';
import { BillingService } from '../../core/services/billing.service';
import { PdfService } from '../../core/services/pdf.service';
import { Bill, BillItem, PaymentMethod } from '../../core/models/bill.model';
import { PaymentModalComponent } from '../../shared/components/payment-modal/payment-modal.component';
import { environment } from '../../../environments/environment';

@Component({
  selector: 'app-bill-detail',
  standalone: true,
  templateUrl: './bill-detail.page.html',
  styleUrls: ['./bill-detail.page.scss'],
  imports: [
    CommonModule,
    IonHeader,
    IonToolbar,
    IonTitle,
    IonButtons,
    IonBackButton,
    IonButton,
    IonIcon,
    IonContent,
    IonBadge,
    IonList,
    IonItem,
    IonLabel,
    IonSkeletonText,
  ],
})
export class BillDetailPage implements OnInit {
  bill: Bill | null = null;
  loading = true;
  sharing = false;
  saving = false;
  company = environment.company;

  /** When true the item list becomes editable (adjust qty / remove a wrong item). */
  editing = false;
  editItems: BillItem[] = [];

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private billingService: BillingService,
    private pdfService: PdfService,
    private modalController: ModalController,
    private toastController: ToastController,
    private alertController: AlertController,
  ) {
    addIcons({ shareOutline, checkmarkCircleOutline, cashOutline, createOutline, trashOutline, addOutline, removeOutline });
  }

  async ngOnInit(): Promise<void> {
    await this.load();
  }

  async load(): Promise<void> {
    const id = this.route.snapshot.paramMap.get('id');
    this.loading = true;
    if (id) {
      this.bill = (await this.billingService.getBillById(id)) ?? null;
    }
    this.loading = false;
  }

  async sharePdf(): Promise<void> {
    if (!this.bill) return;
    this.sharing = true;
    try {
      await this.pdfService.shareBillPdf(this.bill);
    } finally {
      this.sharing = false;
    }
  }

  async markAsPaid(): Promise<void> {
    if (!this.bill) return;
    const result = await this.openPaymentModal('full', this.bill.amountDue);
    if (!result) return;

    await this.billingService.markAsPaid(this.bill.id, result.method, result.chequeNo);
    await this.load();
    const toast = await this.toastController.create({ message: 'Marked as paid', duration: 1500, color: 'success' });
    await toast.present();
  }

  async recordPayment(): Promise<void> {
    if (!this.bill) return;
    const result = await this.openPaymentModal('partial', this.bill.amountDue);
    if (!result) return;

    await this.billingService.recordPartialPayment(this.bill.id, result.amount, result.method, result.chequeNo);
    await this.load();
    const toast = await this.toastController.create({ message: 'Payment recorded', duration: 1500, color: 'success' });
    await toast.present();
  }

  /** Lets the cashier add or correct the cheque number after the bill was already generated. */
  async editChequeNo(): Promise<void> {
    if (!this.bill) return;
    const alert = await this.alertController.create({
      header: 'Cheque No.',
      inputs: [{ name: 'chequeNo', type: 'text', placeholder: 'e.g. 000123', value: this.bill.chequeNo ?? '' }],
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Save',
          handler: async (data) => {
            const chequeNo = (data.chequeNo ?? '').trim();
            if (!chequeNo || !this.bill) return;
            await this.billingService.updateChequeNo(this.bill.id, chequeNo);
            await this.load();
            const toast = await this.toastController.create({ message: 'Cheque No. updated', duration: 1500, color: 'success' });
            await toast.present();
          },
        },
      ],
    });
    await alert.present();
  }

  // --- Edit items ---

  startEdit(): void {
    if (!this.bill) return;
    this.editItems = this.bill.items.map((l) => ({ ...l }));
    this.editing = true;
  }

  cancelEdit(): void {
    this.editing = false;
    this.editItems = [];
  }

  incEdit(line: BillItem): void {
    line.qty += 1;
    this.recalcEdit(line);
  }

  decEdit(line: BillItem): void {
    if (line.qty > 1) {
      line.qty -= 1;
      this.recalcEdit(line);
    }
  }

  removeEditLine(line: BillItem): void {
    this.editItems = this.editItems.filter((l) => l !== line);
  }

  private recalcEdit(line: BillItem): void {
    line.subtotal = line.qty * line.price;
    if (line.discount > line.subtotal) line.discount = line.subtotal;
  }

  get editTotal(): number {
    return this.editItems.reduce((sum, l) => sum + l.subtotal, 0);
  }

  get editDiscount(): number {
    return this.editItems.reduce((sum, l) => sum + l.discount, 0);
  }

  get editGrandTotal(): number {
    return Math.max(0, this.editTotal - this.editDiscount);
  }

  async saveEdit(): Promise<void> {
    if (!this.bill || this.editItems.length === 0 || this.saving) return;
    this.saving = true;
    try {
      await this.billingService.updateBillItems(this.bill.id, this.editItems);
      await this.load();
      this.editing = false;
      this.editItems = [];
      const toast = await this.toastController.create({ message: 'Bill updated', duration: 1500, color: 'success' });
      await toast.present();
    } finally {
      this.saving = false;
    }
  }

  // --- Delete bill ---

  async confirmDelete(): Promise<void> {
    if (!this.bill) return;
    const alert = await this.alertController.create({
      header: 'Delete bill?',
      message: `Delete ${this.bill.billNo}? The stock it used will be restored. This cannot be undone.`,
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Delete',
          role: 'destructive',
          handler: async () => {
            await this.billingService.deleteBill(this.bill!.id);
            const toast = await this.toastController.create({ message: 'Bill deleted', duration: 1500, color: 'success' });
            await toast.present();
            this.router.navigateByUrl('/tabs/bill-history');
          },
        },
      ],
    });
    await alert.present();
  }

  private async openPaymentModal(
    mode: 'full' | 'partial',
    amountDue: number,
  ): Promise<{ amount: number; method: NonNullable<PaymentMethod>; chequeNo?: string } | null> {
    const modal = await this.modalController.create({
      component: PaymentModalComponent,
      componentProps: { mode, amountDue },
    });
    await modal.present();
    const { data, role } = await modal.onWillDismiss();
    return role === 'save' ? data : null;
  }
}
