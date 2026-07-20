import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import {
  IonHeader,
  IonToolbar,
  IonTitle,
  IonButtons,
  IonBackButton,
  IonButton,
  IonContent,
  IonItem,
  IonLabel,
  IonInput,
  IonSelect,
  IonSelectOption,
  IonText,
  IonIcon,
  ModalController,
  ToastController,
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { qrCodeOutline } from 'ionicons/icons';
import { ItemService } from '../../../core/services/item.service';
import { CategoryService } from '../../../core/services/category.service';
import { Category } from '../../../core/models/category.model';
import { ItemUnit, GST_PERCENT_OPTIONS } from '../../../core/models/item.model';
import { BarcodeScannerModalComponent } from '../../../shared/components/barcode-scanner-modal/barcode-scanner-modal.component';
import { EnterNextDirective } from '../../../shared/directives/enter-next.directive';
import { SelectTypeaheadDirective } from '../../../shared/directives/select-typeahead.directive';

@Component({
  selector: 'app-item-form',
  standalone: true,
  templateUrl: './item-form.page.html',
  styleUrls: ['./item-form.page.scss'],
  imports: [
    CommonModule,
    ReactiveFormsModule,
    IonHeader,
    IonToolbar,
    IonTitle,
    IonButtons,
    IonBackButton,
    IonButton,
    IonContent,
    IonItem,
    IonLabel,
    IonInput,
    IonSelect,
    IonSelectOption,
    IonText,
    IonIcon,
    EnterNextDirective,
    SelectTypeaheadDirective,
  ],
})
export class ItemFormPage implements OnInit {
  categories: Category[] = [];
  isEdit = false;
  itemId: string | null = null;
  units: ItemUnit[] = ['pcs', 'box', 'dozen', 'pack'];
  gstOptions = GST_PERCENT_OPTIONS;

  // Number fields start empty (not a prefilled 0 the user has to clear first);
  // edit mode patches the real values in ngOnInit.
  form = this.fb.group({
    name: ['', [Validators.required]],
    categoryId: ['', [Validators.required]],
    purchasePrice: [null as number | null, [Validators.required, Validators.min(0.01)]],
    sellingPrice: [null as number | null, [Validators.required, Validators.min(0.01)]],
    stockQty: [null as number | null, [Validators.required, Validators.min(0)]],
    unit: ['pcs' as ItemUnit, [Validators.required]],
    sku: [''],
    godownLocation: [''],
    hsnCode: [''],
    gstPercent: [null as number | null],
  });

  constructor(
    private fb: FormBuilder,
    private itemService: ItemService,
    private categoryService: CategoryService,
    private route: ActivatedRoute,
    private router: Router,
    private toastController: ToastController,
    private modalController: ModalController,
  ) {
    addIcons({ qrCodeOutline });
  }

  async ngOnInit(): Promise<void> {
    this.categories = await this.categoryService.list();
    this.itemId = this.route.snapshot.paramMap.get('id');
    if (this.itemId) {
      this.isEdit = true;
      const item = await this.itemService.getById(this.itemId);
      if (item) {
        this.form.patchValue({
          name: item.name,
          categoryId: item.categoryId,
          purchasePrice: item.purchasePrice,
          sellingPrice: item.sellingPrice,
          stockQty: item.stockQty,
          unit: item.unit,
          sku: item.sku ?? '',
          godownLocation: item.godownLocation ?? '',
          hsnCode: item.hsnCode ?? '',
          gstPercent: item.gstPercent ?? null,
        });
      }
    }
  }

  async scanSku(): Promise<void> {
    const modal = await this.modalController.create({
      component: BarcodeScannerModalComponent,
      cssClass: 'barcode-scanner-modal',
      showBackdrop: false,
    });
    await modal.present();
    const { data, role } = await modal.onWillDismiss();
    if (role === 'scanned' && data?.barcode) {
      this.form.patchValue({ sku: data.barcode });
    }
  }

  async save(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const raw = this.form.getRawValue();
    const category = this.categories.find((c) => c.id === raw.categoryId);
    const payload = {
      name: raw.name!,
      categoryId: raw.categoryId!,
      category: category?.name,
      purchasePrice: Number(raw.purchasePrice),
      sellingPrice: Number(raw.sellingPrice),
      stockQty: Number(raw.stockQty),
      unit: raw.unit as ItemUnit,
      sku: raw.sku || undefined,
      godownLocation: raw.godownLocation || undefined,
      hsnCode: raw.hsnCode || null,
      gstPercent: raw.gstPercent === null || raw.gstPercent === undefined ? null : Number(raw.gstPercent),
    };

    if (this.isEdit && this.itemId) {
      await this.itemService.update(this.itemId, payload);
    } else {
      await this.itemService.create(payload);
    }

    const toast = await this.toastController.create({
      message: this.isEdit ? 'Item updated' : 'Item added',
      duration: 1500,
      color: 'success',
    });
    await toast.present();
    this.router.navigateByUrl('/tabs/items', { replaceUrl: true });
  }
}
