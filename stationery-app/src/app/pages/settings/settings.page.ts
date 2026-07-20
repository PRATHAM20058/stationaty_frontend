import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder } from '@angular/forms';
import { Router } from '@angular/router';
import {
  IonHeader,
  IonToolbar,
  IonTitle,
  IonButtons,
  IonBackButton,
  IonContent,
  IonList,
  IonListHeader,
  IonItem,
  IonLabel,
  IonNote,
  IonInput,
  IonButton,
  AlertController,
  ToastController,
} from '@ionic/angular/standalone';
import { environment } from '../../../environments/environment';
import { AuthService } from '../../core/services/auth.service';
import { SellerConfigService } from '../../core/services/seller-config.service';

@Component({
  selector: 'app-settings',
  standalone: true,
  templateUrl: './settings.page.html',
  imports: [
    CommonModule,
    ReactiveFormsModule,
    IonHeader,
    IonToolbar,
    IonTitle,
    IonButtons,
    IonBackButton,
    IonContent,
    IonList,
    IonListHeader,
    IonItem,
    IonLabel,
    IonNote,
    IonInput,
    IonButton,
  ],
})
export class SettingsPage implements OnInit {
  apiUrl = environment.apiUrl;
  currentUser$ = this.auth.currentUser$;

  // The shop's own GST/business identity, printed on tax invoices. `mobiles` is edited as a
  // comma-separated string and split back into an array on save.
  form = this.fb.group({
    businessName: [''],
    subtitle: [''],
    address: [''],
    sellerGstin: [''],
    pan: [''],
    mobiles: [''],
    sellerState: [''],
    sellerStateCode: [''],
    bankName: [''],
    bankAccountNo: [''],
    ifsc: [''],
  });

  constructor(
    private auth: AuthService,
    private router: Router,
    private alertController: AlertController,
    private toastController: ToastController,
    private fb: FormBuilder,
    private sellerConfig: SellerConfigService,
  ) {}

  async ngOnInit(): Promise<void> {
    const cfg = await this.sellerConfig.get();
    this.form.patchValue({ ...cfg, mobiles: cfg.mobiles.join(', ') });
  }

  async saveProfile(): Promise<void> {
    const raw = this.form.getRawValue();
    await this.sellerConfig.save({
      businessName: raw.businessName ?? '',
      subtitle: raw.subtitle ?? '',
      address: raw.address ?? '',
      sellerGstin: raw.sellerGstin ?? '',
      pan: raw.pan ?? '',
      mobiles: (raw.mobiles ?? '')
        .split(',')
        .map((m) => m.trim())
        .filter((m) => m.length > 0),
      sellerState: raw.sellerState ?? '',
      sellerStateCode: raw.sellerStateCode ?? '',
      bankName: raw.bankName ?? '',
      bankAccountNo: raw.bankAccountNo ?? '',
      ifsc: raw.ifsc ?? '',
    });
    const toast = await this.toastController.create({ message: 'Business profile saved', duration: 1500, color: 'success' });
    await toast.present();
  }

  async logout(): Promise<void> {
    const alert = await this.alertController.create({
      header: 'Logout',
      message: 'Are you sure you want to logout?',
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Logout',
          role: 'destructive',
          handler: async () => {
            await this.auth.logout();
            this.router.navigateByUrl('/login', { replaceUrl: true });
          },
        },
      ],
    });
    await alert.present();
  }
}
