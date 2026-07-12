import { Component, DestroyRef, ElementRef, OnInit, ViewChild, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import {
  IonHeader,
  IonToolbar,
  IonTitle,
  IonButtons,
  IonMenuButton,
  IonContent,
  IonList,
  IonItem,
  IonLabel,
  IonBadge,
  IonSegment,
  IonSegmentButton,
} from '@ionic/angular/standalone';
import { BillingService } from '../../core/services/billing.service';
import { ItemService } from '../../core/services/item.service';
import { Item } from '../../core/models/item.model';

interface DayBucket {
  label: string;
  total: number;
}

@Component({
  selector: 'app-reports',
  standalone: true,
  templateUrl: './reports.page.html',
  styleUrls: ['./reports.page.scss'],
  imports: [
    CommonModule,
    IonHeader,
    IonToolbar,
    IonTitle,
    IonButtons,
    IonMenuButton,
    IonContent,
    IonList,
    IonItem,
    IonLabel,
    IonBadge,
    IonSegment,
    IonSegmentButton,
  ],
})
export class ReportsPage implements OnInit {
  range: 'week' | 'month' = 'week';
  buckets: DayBucket[] = [];
  lowStockItems: Item[] = [];
  topItems: { itemName: string; qtySold: number; revenue: number }[] = [];
  lowItems: { itemName: string; qtySold: number; revenue: number }[] = [];
  loading = true;

  /** Rounded top of the ₹ axis; bars and gridlines share this scale. */
  niceMax = 1;
  /** Money-axis ticks, bottom (₹0) to top (niceMax). */
  ticks: { value: number; frac: number }[] = [];
  /** Best-selling day — its value is labelled on the chart by default. */
  peakIndex = -1;
  /** Bar the user tapped to inspect; shows its ₹ value in place of the peak's. */
  selectedIndex: number | null = null;
  totalInRange = 0;

  @ViewChild('plotEl') private plotRef?: ElementRef<HTMLDivElement>;

  private destroyRef = inject(DestroyRef);

  constructor(
    private billingService: BillingService,
    private itemService: ItemService,
  ) {}

  async ngOnInit(): Promise<void> {
    await this.load();
    // Live-refresh charts/top-low lists when a bill changes elsewhere, so this cached
    // tab is already fresh whenever the user returns to it (by any navigation path).
    this.billingService.changes$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => this.load());
  }

  async ionViewWillEnter(): Promise<void> {
    await this.load();
  }

  async setRange(range: 'week' | 'month'): Promise<void> {
    this.range = range;
    await this.load();
  }

  async load(): Promise<void> {
    this.loading = true;
    const days = this.range === 'week' ? 7 : 30;
    const from = new Date();
    from.setDate(from.getDate() - (days - 1));
    from.setHours(0, 0, 0, 0);

    const bills = await this.billingService.listBills({ from: from.toISOString() });

    const dayTotals = new Map<string, number>();
    for (let i = 0; i < days; i++) {
      const d = new Date(from);
      d.setDate(from.getDate() + i);
      dayTotals.set(d.toDateString(), 0);
    }
    for (const bill of bills) {
      const key = new Date(bill.date).toDateString();
      if (dayTotals.has(key)) {
        dayTotals.set(key, (dayTotals.get(key) ?? 0) + bill.amountPaid);
      }
    }

    this.buckets = Array.from(dayTotals.entries()).map(([key, total]) => ({
      label: new Date(key).toLocaleDateString(undefined, { day: '2-digit', month: 'short' }),
      total,
    }));

    this.totalInRange = this.buckets.reduce((sum, b) => sum + b.total, 0);
    const rawMax = Math.max(...this.buckets.map((b) => b.total), 0);
    this.niceMax = this.niceCeil(rawMax);
    this.ticks = [0, 1, 2, 3, 4].map((i) => ({ frac: i / 4, value: Math.round((this.niceMax * i) / 4) }));
    this.peakIndex = rawMax > 0 ? this.buckets.findIndex((b) => b.total === rawMax) : -1;
    this.selectedIndex = null;

    this.topItems = await this.billingService.getTopItems(from.toISOString());
    this.lowItems = await this.billingService.getLowItems(from.toISOString());
    this.lowStockItems = await this.itemService.lowStock();
    this.loading = false;

    // Show the most recent days first — scroll the plot to its right end.
    setTimeout(() => {
      const el = this.plotRef?.nativeElement;
      if (el) el.scrollLeft = el.scrollWidth;
    });
  }

  get avgPerDay(): number {
    return this.buckets.length ? this.totalInRange / this.buckets.length : 0;
  }

  /** Bars are scaled to the rounded axis top so their caps line up with the gridlines. */
  barHeight(total: number): number {
    if (total <= 0) return 2;
    return Math.max(3, Math.round((total / this.niceMax) * 120));
  }

  selectBar(index: number): void {
    this.selectedIndex = this.selectedIndex === index ? null : index;
  }

  /** Compact ₹ tick text: 750 → "750", 12500 → "12.5K". */
  fmtTick(value: number): string {
    if (value >= 1000) {
      const k = value / 1000;
      return (Number.isInteger(k) ? String(k) : k.toFixed(1)) + 'K';
    }
    return String(value);
  }

  /** Smallest "clean" axis top ≥ the data max, so ticks land on round numbers. */
  private niceCeil(value: number): number {
    if (value <= 0) return 100;
    const rawStep = value / 4;
    const pow = Math.pow(10, Math.floor(Math.log10(rawStep)));
    const norm = rawStep / pow;
    const niceNorm = [1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].find((m) => m >= norm) ?? 10;
    return niceNorm * pow * 4;
  }
}
