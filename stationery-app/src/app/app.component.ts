import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import {
  IonApp,
  IonRouterOutlet,
  IonSplitPane,
  IonMenu,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonList,
  IonItem,
  IonIcon,
  IonMenuToggle,
  AlertController,
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { pricetagsOutline, settingsOutline, logOutOutline } from 'ionicons/icons';
import { Capacitor } from '@capacitor/core';
import { StatusBar, Style } from '@capacitor/status-bar';
import { AuthService } from './core/services/auth.service';
import { SyncService } from './core/services/sync.service';
import { OfflineBannerComponent } from './shared/components/offline-banner/offline-banner.component';

@Component({
  selector: 'app-root',
  templateUrl: 'app.component.html',
  standalone: true,
  imports: [
    CommonModule,
    RouterLink,
    IonApp,
    IonRouterOutlet,
    IonSplitPane,
    IonMenu,
    IonHeader,
    IonToolbar,
    IonTitle,
    IonContent,
    IonList,
    IonItem,
    IonIcon,
    IonMenuToggle,
    OfflineBannerComponent,
  ],
})
export class AppComponent {
  currentUser$ = this.auth.currentUser$;

  constructor(
    private auth: AuthService,
    private sync: SyncService,
    private router: Router,
    private alertController: AlertController,
  ) {
    addIcons({ pricetagsOutline, settingsOutline, logOutOutline });
    this.sync.start();
    this.initStatusBar();
  }

  /**
   * Keep the native status bar as a solid white strip that the WebView sits
   * *below* on every device. This avoids both the header overlapping the status
   * bar (edge-to-edge phones) and the large empty gap some OEMs (e.g. MIUI)
   * showed from a hard-coded top inset.
   */
  private initStatusBar(): void {
    if (!Capacitor.isNativePlatform()) return;
    StatusBar.setOverlaysWebView({ overlay: false }).catch(() => {});
    StatusBar.setStyle({ style: Style.Light }).catch(() => {});
    StatusBar.setBackgroundColor({ color: '#ffffff' }).catch(() => {});
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
            this.router.navigateByUrl('/login');
          },
        },
      ],
    });
    await alert.present();
  }
}
