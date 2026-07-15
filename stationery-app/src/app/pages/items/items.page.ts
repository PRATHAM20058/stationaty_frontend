import { Component, DestroyRef, ElementRef, OnInit, ViewChild, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import {
  IonHeader,
  IonToolbar,
  IonTitle,
  IonButtons,
  IonMenuButton,
  IonButton,
  IonIcon,
  IonContent,
  IonSearchbar,
  IonChip,
  IonLabel,
  IonList,
  IonItemSliding,
  IonItem,
  IonBadge,
  IonItemOptions,
  IonItemOption,
  IonSkeletonText,
  AlertController,
  ToastController,
  LoadingController,
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { addOutline, trashOutline, createOutline, cubeOutline, cloudUploadOutline, downloadOutline } from 'ionicons/icons';
import { ItemService } from '../../core/services/item.service';
import { CategoryService } from '../../core/services/category.service';
import { ItemImportService } from '../../core/services/item-import.service';
import { Item } from '../../core/models/item.model';
import { Category } from '../../core/models/category.model';
import { environment } from '../../../environments/environment';

@Component({
  selector: 'app-items',
  standalone: true,
  templateUrl: './items.page.html',
  styleUrls: ['./items.page.scss'],
  imports: [
    CommonModule,
    IonHeader,
    IonToolbar,
    IonTitle,
    IonButtons,
    IonMenuButton,
    IonButton,
    IonIcon,
    IonContent,
    IonSearchbar,
    IonChip,
    IonLabel,
    IonList,
    IonItemSliding,
    IonItem,
    IonBadge,
    IonItemOptions,
    IonItemOption,
    IonSkeletonText,
  ],
})
export class ItemsPage implements OnInit {
  items: Item[] = [];
  categories: Category[] = [];
  loading = true;
  searchTerm = '';
  selectedCategoryId: string | null = null;
  lowStockThreshold = environment.lowStockThreshold;

  @ViewChild('fileInput') fileInput!: ElementRef<HTMLInputElement>;

  private destroyRef = inject(DestroyRef);

  constructor(
    private itemService: ItemService,
    private categoryService: CategoryService,
    private itemImportService: ItemImportService,
    private router: Router,
    private alertController: AlertController,
    private toastController: ToastController,
    private loadingController: LoadingController,
  ) {
    addIcons({ addOutline, trashOutline, createOutline, cubeOutline, cloudUploadOutline, downloadOutline });
  }

  ngOnInit(): void {
    this.load();
    this.itemService.refreshFromServer().then(() => this.load()).catch(() => {});
    // Item edit/add opens as a top-level route on top of the tabs shell, so this page's
    // ionViewWillEnter does NOT fire when the user returns after changing stock qty.
    // Subscribe to item changes so the list (and stock badges) stay in sync.
    this.itemService.changes$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => this.load());
  }

  async ionViewWillEnter(): Promise<void> {
    await this.load();
  }

  async load(): Promise<void> {
    this.loading = true;
    this.categories = await this.categoryService.list();
    this.items = await this.itemService.list({
      search: this.searchTerm || undefined,
      categoryId: this.selectedCategoryId || undefined,
    });
    this.loading = false;
  }

  onSearch(value: string | null | undefined): void {
    this.searchTerm = value ?? '';
    this.load();
  }

  selectCategory(categoryId: string | null): void {
    this.selectedCategoryId = this.selectedCategoryId === categoryId ? null : categoryId;
    this.load();
  }

  goToNew(): void {
    this.router.navigateByUrl('/items/new');
  }

  /** Generates and hands the user a ready-to-fill Excel template with the exact columns. */
  async downloadTemplate(): Promise<void> {
    try {
      await this.itemImportService.downloadTemplate();
    } catch (err: any) {
      const toast = await this.toastController.create({
        message: `Could not create the template. ${err?.message ?? ''}`.trim(),
        duration: 2500,
        color: 'danger',
      });
      await toast.present();
    }
  }

  /** Opens the file explorer to pick an Excel file of items to bulk-import. */
  openImport(): void {
    this.fileInput.nativeElement.click();
  }

  /** Parses the chosen Excel file, creates each item, and reports the result. */
  async onExcelSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    const loading = await this.loadingController.create({ message: 'Importing items…' });
    await loading.present();
    try {
      const buffer = await file.arrayBuffer();
      const result = await this.itemImportService.importFromArrayBuffer(buffer);
      await loading.dismiss();

      const errorLines = result.errors.slice(0, 8).map((e) => `Row ${e.row}: ${e.message}`);
      if (result.errors.length > 8) errorLines.push(`…and ${result.errors.length - 8} more`);
      const summary = [`${result.created} item(s) imported.`];
      if (result.skipped) summary.push(`${result.skipped} row(s) skipped.`);
      const message = summary.join(' ') + (errorLines.length ? `\n\n${errorLines.join('\n')}` : '');

      const alert = await this.alertController.create({
        header: result.created > 0 ? 'Import complete' : 'Nothing imported',
        message,
        cssClass: 'import-result-alert',
        buttons: ['OK'],
      });
      await alert.present();
      await this.load();
    } catch (err: any) {
      await loading.dismiss();
      const toast = await this.toastController.create({
        message: `Could not read that file. ${err?.message ?? ''}`.trim(),
        duration: 2500,
        color: 'danger',
      });
      await toast.present();
    } finally {
      // Reset so picking the same file again still fires (change) next time.
      input.value = '';
    }
  }

  goToDetail(item: Item): void {
    this.router.navigateByUrl(`/items/${item.id}`);
  }

  goToEdit(item: Item): void {
    this.router.navigateByUrl(`/items/${item.id}/edit`);
  }

  async confirmDelete(item: Item, slidingItem: IonItemSliding): Promise<void> {
    await slidingItem.close();
    const alert = await this.alertController.create({
      header: 'Delete item?',
      message: `Delete "${item.name}"? This cannot be undone.`,
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Delete',
          role: 'destructive',
          handler: async () => {
            await this.itemService.delete(item.id);
            const toast = await this.toastController.create({ message: 'Item deleted', duration: 1800, color: 'success' });
            await toast.present();
            await this.load();
          },
        },
      ],
    });
    await alert.present();
  }
}
