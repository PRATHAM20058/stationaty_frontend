import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonIcon } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { cloudOfflineOutline } from 'ionicons/icons';
import { SyncService } from '../../../core/services/sync.service';

@Component({
  selector: 'app-offline-banner',
  standalone: true,
  imports: [CommonModule, IonIcon],
  template: `
    @if ((state$ | async) === 'offline') {
      <div class="offline-banner">
        <ion-icon name="cloud-offline-outline"></ion-icon>
        <span>Offline — changes will sync when internet is back</span>
      </div>
    }
  `,
  styles: [
    `
      .offline-banner {
        display: flex;
        align-items: center;
        gap: 8px;
        justify-content: center;
        padding: 6px 12px;
        background: var(--ion-color-warning, #ffce00);
        color: var(--ion-color-warning-contrast, #000);
        font-size: 0.85rem;
        font-weight: 500;
      }
    `,
  ],
})
export class OfflineBannerComponent {
  state$ = this.sync.state$;

  constructor(private sync: SyncService) {
    addIcons({ cloudOfflineOutline });
  }
}
