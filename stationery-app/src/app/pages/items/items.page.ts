import { Component, OnInit } from '@angular/core';
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
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { addOutline, trashOutline, createOutline, cubeOutline } from 'ionicons/icons';
import { ItemService } from '../../core/services/item.service';
import { CategoryService } from '../../core/services/category.service';
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

  constructor(
    private itemService: ItemService,
    private categoryService: CategoryService,
    private router: Router,
    private alertController: AlertController,
    private toastController: ToastController,
  ) {
    addIcons({ addOutline, trashOutline, createOutline, cubeOutline });
  }

  ngOnInit(): void {
    this.load();
    this.itemService.refreshFromServer().then(() => this.load()).catch(() => {});
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
