import { Component, OnInit, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import {
  IonHeader,
  IonToolbar,
  IonTitle,
  IonButtons,
  IonMenuButton,
  IonContent,
  IonSearchbar,
  IonChip,
  IonLabel,
  IonList,
  IonItem,
  IonBadge,
  IonSkeletonText,
  IonButton,
  IonModal,
  IonDatetime,
  IonIcon,
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { receiptOutline, calendarOutline, closeCircle } from 'ionicons/icons';
import { BillingService } from '../../core/services/billing.service';
import { Bill, PaymentStatus } from '../../core/models/bill.model';

type StatusFilter = 'all' | PaymentStatus;

@Component({
  selector: 'app-bill-history',
  standalone: true,
  templateUrl: './bill-history.page.html',
  styleUrls: ['./bill-history.page.scss'],
  imports: [
    CommonModule,
    FormsModule,
    IonHeader,
    IonToolbar,
    IonTitle,
    IonButtons,
    IonMenuButton,
    IonContent,
    IonSearchbar,
    IonChip,
    IonLabel,
    IonList,
    IonItem,
    IonBadge,
    IonSkeletonText,
    IonButton,
    IonModal,
    IonDatetime,
    IonIcon,
  ],
})
export class BillHistoryPage implements OnInit {
  @ViewChild('dateModal') dateModal!: IonModal;

  bills: Bill[] = [];
  loading = true;
  statusFilter: StatusFilter = 'all';

  /** Empty by default -- shows every bill. When set, filters to just that single local day. */
  fromDateInput = '';
  /** Search a customer's bill(s) by name or phone number to check paid/pending status. */
  searchTerm = '';

  statusOptions: { value: StatusFilter; label: string }[] = [
    { value: 'all', label: 'All' },
    { value: 'paid', label: 'Paid' },
    { value: 'pending', label: 'Pending' },
    { value: 'partial', label: 'Partial' },
  ];

  constructor(
    private billingService: BillingService,
    private router: Router,
  ) {
    addIcons({ receiptOutline, calendarOutline, closeCircle });
  }

  async ngOnInit(): Promise<void> {
    await this.load();
  }

  async ionViewWillEnter(): Promise<void> {
    await this.load();
  }

  /** A day was tapped in the calendar modal: apply it and close the picker. */
  async onDatePicked(value: string | string[] | null | undefined): Promise<void> {
    this.fromDateInput = typeof value === 'string' ? value : '';
    await this.dateModal.dismiss();
    await this.load();
  }

  clearFromDate(): void {
    this.fromDateInput = '';
    this.load();
  }

  onSearch(value: string | null | undefined): void {
    this.searchTerm = value ?? '';
    this.load();
  }

  selectStatus(status: StatusFilter): void {
    this.statusFilter = status;
    this.load();
  }

  async load(): Promise<void> {
    this.loading = true;
    try {
      // Parse the picker value's date part into local date parts -- new Date("YYYY-MM-DD")
      // parses as UTC midnight, not local midnight, which silently drops early-morning
      // local bills on the selected day. Building both bounds also turns this into a
      // single-day filter instead of an open-ended "from this date on" lower bound.
      // ion-datetime can emit either "YYYY-MM-DD" or "YYYY-MM-DDTHH:mm:ss" depending on
      // interaction, so the date part is taken before any "T" rather than assuming no time.
      let from: string | undefined;
      let to: string | undefined;
      if (this.fromDateInput) {
        const [year, month, day] = this.fromDateInput.split('T')[0].split('-').map(Number);
        from = new Date(year, month - 1, day, 0, 0, 0, 0).toISOString();
        to = new Date(year, month - 1, day, 23, 59, 59, 999).toISOString();
      }
      this.bills = await this.billingService.listBills({
        from,
        to,
        paymentStatus: this.statusFilter === 'all' ? undefined : this.statusFilter,
        search: this.searchTerm.trim() || undefined,
      });
    } finally {
      this.loading = false;
    }
  }

  goToDetail(bill: Bill): void {
    this.router.navigateByUrl(`/bills/${bill.id}`);
  }
}
