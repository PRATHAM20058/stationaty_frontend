import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  IonHeader,
  IonToolbar,
  IonTitle,
  IonButtons,
  IonBackButton,
  IonButton,
  IonIcon,
  IonContent,
  IonList,
  IonItemSliding,
  IonItem,
  IonLabel,
  IonBadge,
  IonItemOptions,
  IonItemOption,
  IonSkeletonText,
  ModalController,
  AlertController,
  ToastController,
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { addOutline, trashOutline, createOutline, pricetagsOutline } from 'ionicons/icons';
import { CategoryService } from '../../core/services/category.service';
import { Category } from '../../core/models/category.model';
import { CategoryFormModalComponent } from './category-form-modal.component';

@Component({
  selector: 'app-categories',
  standalone: true,
  templateUrl: './categories.page.html',
  styleUrls: ['./categories.page.scss'],
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
    IonList,
    IonItemSliding,
    IonItem,
    IonLabel,
    IonBadge,
    IonItemOptions,
    IonItemOption,
    IonSkeletonText,
  ],
})
export class CategoriesPage implements OnInit {
  categories: Category[] = [];
  loading = true;

  constructor(
    private categoryService: CategoryService,
    private modalController: ModalController,
    private alertController: AlertController,
    private toastController: ToastController,
  ) {
    addIcons({ addOutline, trashOutline, createOutline, pricetagsOutline });
  }

  ngOnInit(): void {
    this.load();
    this.categoryService.refreshFromServer().then(() => this.load()).catch(() => {});
  }

  async load(): Promise<void> {
    this.loading = true;
    this.categories = await this.categoryService.list();
    this.loading = false;
  }

  async openForm(category?: Category): Promise<void> {
    const modal = await this.modalController.create({
      component: CategoryFormModalComponent,
      componentProps: { category },
    });
    await modal.present();
    const { data, role } = await modal.onWillDismiss();
    if (role === 'save' && data?.name) {
      if (category) {
        await this.categoryService.update(category.id, data.name);
        this.toast('Category updated');
      } else {
        await this.categoryService.create(data.name);
        this.toast('Category added');
      }
      await this.load();
    }
  }

  async confirmDelete(category: Category, slidingItem: IonItemSliding): Promise<void> {
    await slidingItem.close();
    const alert = await this.alertController.create({
      header: 'Delete category?',
      message: `Delete "${category.name}"? This cannot be undone.`,
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Delete',
          role: 'destructive',
          handler: async () => {
            await this.categoryService.delete(category.id);
            this.toast('Category deleted');
            await this.load();
          },
        },
      ],
    });
    await alert.present();
  }

  private async toast(message: string): Promise<void> {
    const toast = await this.toastController.create({ message, duration: 1800, color: 'success' });
    await toast.present();
  }
}
