import { Component, DestroyRef, OnInit, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import {
  IonContent,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonButtons,
  IonMenuButton,
  IonGrid,
  IonRow,
  IonCol,
  IonCard,
  IonCardContent,
  IonCardHeader,
  IonCardTitle,
  IonIcon,
  IonButton,
  IonBadge,
  IonList,
  IonItem,
  IonLabel,
  IonSkeletonText,
  IonRefresher,
  IonRefresherContent,
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  cashOutline,
  receiptOutline,
  alertCircleOutline,
  addCircleOutline,
  cartOutline,
  timeOutline,
  cubeOutline,
} from 'ionicons/icons';
import { BillingService } from '../../core/services/billing.service';
import { ItemService } from '../../core/services/item.service';
import { Item } from '../../core/models/item.model';
import { SyncStatusComponent } from '../../shared/components/sync-status/sync-status.component';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  templateUrl: './dashboard.page.html',
  styleUrls: ['./dashboard.page.scss'],
  imports: [
    CommonModule,
    IonContent,
    IonHeader,
    IonToolbar,
    IonTitle,
    IonButtons,
    IonMenuButton,
    IonGrid,
    IonRow,
    IonCol,
    IonCard,
    IonCardContent,
    IonCardHeader,
    IonCardTitle,
    IonIcon,
    IonButton,
    IonBadge,
    IonList,
    IonItem,
    IonLabel,
    IonSkeletonText,
    IonRefresher,
    IonRefresherContent,
    SyncStatusComponent,
  ],
})
export class DashboardPage implements OnInit {
  loading = true;
  totalSales = 0;
  billCount = 0;
  pendingTotalDue = 0;
  pendingCount = 0;
  lowStockItems: Item[] = [];

  private destroyRef = inject(DestroyRef);

  constructor(
    private billingService: BillingService,
    private itemService: ItemService,
    private router: Router,
  ) {
    addIcons({ cashOutline, receiptOutline, alertCircleOutline, addCircleOutline, cartOutline, timeOutline, cubeOutline });
  }

  ngOnInit(): void {
    this.load();
    // Live-refresh when a bill is created/paid/edited/deleted elsewhere, so this cached
    // tab is already up to date whenever the user returns to it (by any navigation path).
    this.billingService.changes$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => this.load());
  }

  async ionViewWillEnter(): Promise<void> {
    await this.load();
  }

  async load(event?: CustomEvent): Promise<void> {
    this.loading = true;
    const [summary, pending, lowStock] = await Promise.all([
      this.billingService.getTodaySummary(),
      this.billingService.getPendingSummary(),
      this.itemService.lowStock(),
    ]);
    this.totalSales = summary.totalSales;
    this.billCount = summary.billCount;
    this.pendingTotalDue = pending.totalDue;
    this.pendingCount = pending.count;
    this.lowStockItems = lowStock;
    this.loading = false;
    (event?.target as any)?.complete?.();
  }

  goToBilling(): void {
    this.router.navigateByUrl('/tabs/billing');
  }

  goToAddItem(): void {
    this.router.navigateByUrl('/items/new');
  }

  goToPendingBills(): void {
    this.router.navigateByUrl('/pending-bills');
  }
}
