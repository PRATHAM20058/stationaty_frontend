import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonButton, IonIcon, ModalController, ToastController } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { closeOutline, imageOutline, flashOutline, flashOffOutline } from 'ionicons/icons';
import { Capacitor } from '@capacitor/core';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import { BarcodeScanner, BarcodeFormat } from '@capacitor-mlkit/barcode-scanning';
import type { Barcode } from '@capacitor-mlkit/barcode-scanning';
import type { PluginListenerHandle } from '@capacitor/core';

const PRODUCT_BARCODE_FORMATS = [
  BarcodeFormat.Ean13,
  BarcodeFormat.Ean8,
  BarcodeFormat.UpcA,
  BarcodeFormat.UpcE,
  BarcodeFormat.Code128,
  BarcodeFormat.Code39,
  BarcodeFormat.Itf,
  BarcodeFormat.QrCode,
];

/**
 * Full-screen modal for scanning a product barcode with the live camera, with a
 * "choose from gallery" fallback for when the physical product isn't on hand.
 * The native camera preview renders *behind* the WebView, so this component (and
 * `body.barcode-scanner-active` in global.scss) makes everything transparent while
 * scanning is active -- see @capacitor-mlkit/barcode-scanning's README for the pattern.
 */
@Component({
  selector: 'app-barcode-scanner-modal',
  standalone: true,
  imports: [CommonModule, IonButton, IonIcon],
  templateUrl: './barcode-scanner-modal.component.html',
  styleUrls: ['./barcode-scanner-modal.component.scss'],
})
export class BarcodeScannerModalComponent implements OnInit, OnDestroy {
  scanning = false;
  torchOn = false;
  statusMessage = 'Starting camera…';
  private listenerHandle?: PluginListenerHandle;
  private readonly isWeb = Capacitor.getPlatform() === 'web';

  constructor(
    private modalController: ModalController,
    private toastController: ToastController,
  ) {
    addIcons({ closeOutline, imageOutline, flashOutline, flashOffOutline });
  }

  async ngOnInit(): Promise<void> {
    if (this.isWeb) {
      this.statusMessage = 'Live scanning needs the Android app. Use "Choose from Gallery" instead.';
      return;
    }
    await this.beginLiveScan();
  }

  async ngOnDestroy(): Promise<void> {
    await this.stopLiveScan();
  }

  private async beginLiveScan(): Promise<void> {
    const { supported } = await BarcodeScanner.isSupported();
    if (!supported) {
      await this.showToast('Barcode scanning is not supported on this device.');
      return this.cancel();
    }

    let permission = await BarcodeScanner.checkPermissions();
    if (permission.camera !== 'granted' && permission.camera !== 'limited') {
      permission = await BarcodeScanner.requestPermissions();
    }
    if (permission.camera !== 'granted' && permission.camera !== 'limited') {
      await this.showToast('Camera permission is required to scan barcodes.');
      return this.cancel();
    }

    if (Capacitor.getPlatform() === 'android') {
      const { available } = await BarcodeScanner.isGoogleBarcodeScannerModuleAvailable();
      if (!available) {
        this.statusMessage = 'Downloading scanner components…';
        await BarcodeScanner.installGoogleBarcodeScannerModule();
      }
    }

    document.body.classList.add('barcode-scanner-active');
    this.listenerHandle = await BarcodeScanner.addListener('barcodesScanned', async (event) => {
      const barcode = event.barcodes[0];
      const value = barcode?.rawValue ?? barcode?.displayValue;
      if (value) {
        await this.finish(value);
      }
    });

    await BarcodeScanner.startScan({ formats: PRODUCT_BARCODE_FORMATS });
    this.scanning = true;
    this.statusMessage = 'Align the barcode within the frame';
  }

  private async stopLiveScan(): Promise<void> {
    document.body.classList.remove('barcode-scanner-active');
    await this.listenerHandle?.remove();
    this.listenerHandle = undefined;
    if (this.scanning) {
      await BarcodeScanner.stopScan();
      this.scanning = false;
    }
  }

  async pickFromGallery(): Promise<void> {
    await this.stopLiveScan();
    this.statusMessage = 'Opening gallery…';
    try {
      const photo = await Camera.getPhoto({ source: CameraSource.Photos, resultType: CameraResultType.Uri, quality: 90 });

      let barcodes: Barcode[];
      if (this.isWeb && photo.webPath) {
        const blob = await (await fetch(photo.webPath)).blob();
        ({ barcodes } = await BarcodeScanner.readBarcodesFromImage({ blob, formats: PRODUCT_BARCODE_FORMATS }));
      } else if (photo.path) {
        ({ barcodes } = await BarcodeScanner.readBarcodesFromImage({ path: photo.path, formats: PRODUCT_BARCODE_FORMATS }));
      } else {
        barcodes = [];
      }

      const value = barcodes[0]?.rawValue ?? barcodes[0]?.displayValue;
      if (value) {
        await this.finish(value);
      } else {
        await this.showToast('No barcode found in that image. Try again.');
        if (!this.isWeb) await this.beginLiveScan();
        else this.statusMessage = 'Use "Choose from Gallery" to scan a barcode image.';
      }
    } catch {
      // User cancelled the gallery picker -- just resume scanning.
      if (!this.isWeb) await this.beginLiveScan();
      else this.statusMessage = 'Use "Choose from Gallery" to scan a barcode image.';
    }
  }

  async toggleTorch(): Promise<void> {
    await BarcodeScanner.toggleTorch();
    const { enabled } = await BarcodeScanner.isTorchEnabled();
    this.torchOn = enabled;
  }

  async cancel(): Promise<void> {
    await this.stopLiveScan();
    await this.modalController.dismiss(null, 'cancel');
  }

  private async finish(barcode: string): Promise<void> {
    await this.stopLiveScan();
    await this.modalController.dismiss({ barcode }, 'scanned');
  }

  private async showToast(message: string): Promise<void> {
    const toast = await this.toastController.create({ message, duration: 2200, color: 'warning' });
    await toast.present();
  }
}
