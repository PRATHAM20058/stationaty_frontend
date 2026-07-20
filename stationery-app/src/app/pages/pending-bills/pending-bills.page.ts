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
  IonBackButton,
  IonContent,
  IonSearchbar,
  IonList,
  IonItem,
  IonLabel,
  IonBadge,
  IonSkeletonText,
  IonIcon,
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { checkmarkDoneOutline } from 'ionicons/icons';
import { BillingService } from '../../core/services/billing.service';
import { Bill } from '../../core/models/bill.model';

@Component({
  selector: 'app-pending-bills',
  standalone: true,
  templateUrl: './pending-bills.page.html',
  styleUrls: ['./pending-bills.page.scss'],
  imports: [
    CommonModule,
    FormsModule,
    IonHeader,
    IonToolbar,
    IonTitle,
    IonButtons,
    IonBackButton,
    IonContent,
    IonSearchbar,
    IonList,
    IonItem,
    IonLabel,
    IonBadge,
    IonSkeletonText,
    IonIcon,
  ],
})
export class PendingBillsPage implements OnInit {
  bills: Bill[] = [];
  filtered: Bill[] = [];
  loading = true;
  customerFilter = '';

  totalDue = 0;

  private destroyRef = inject(DestroyRef);

  constructor(
    private billingService: BillingService,
    private router: Router,
  ) {
    addIcons({ checkmarkDoneOutline });
  }

  async ngOnInit(): Promise<void> {
    await this.load();
    // Pull the latest bills from the backend, then re-render (offline-safe: ignore failures).
    this.billingService.refreshFromServer().then(() => this.load()).catch(() => {});
    // The bill detail page opens as a top-level route over the tabs shell, so returning
    // from it does not always re-fire ionViewWillEnter here. Subscribe to bill changes
    // so a recorded payment / edit is reflected in this list right away.
    this.billingService.changes$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => this.load());
  }

  async ionViewWillEnter(): Promise<void> {
    await this.load();
  }

  async load(): Promise<void> {
    this.loading = true;
    this.bills = await this.billingService.listPendingBills();
    this.totalDue = this.bills.reduce((sum, b) => sum + b.amountDue, 0);
    this.applyFilter();
    this.loading = false;
  }

  applyFilter(): void {
    const term = this.customerFilter.trim().toLowerCase();
    this.filtered = term ? this.bills.filter((b) => b.customerName.toLowerCase().includes(term)) : this.bills;
  }

  daysSince(dateStr: string): number {
    const diff = Date.now() - new Date(dateStr).getTime();
    return Math.max(0, Math.floor(diff / (1000 * 60 * 60 * 24)));
  }

  goToDetail(bill: Bill): void {
    this.router.navigateByUrl(`/bills/${bill.id}`);
  }
}
