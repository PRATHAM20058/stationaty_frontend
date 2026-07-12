import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonIcon, IonBadge } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { cloudDoneOutline, syncOutline, cloudUploadOutline, warningOutline, cloudOfflineOutline } from 'ionicons/icons';
import { SyncService } from '../../../core/services/sync.service';

@Component({
  selector: 'app-sync-status',
  standalone: true,
  imports: [CommonModule, IonIcon, IonBadge],
  template: `
    <div class="sync-status" [class.spin]="(state$ | async) === 'syncing'">
      <ion-icon [name]="iconFor((state$ | async))"></ion-icon>
      @if ((pendingCount$ | async); as count) {
        @if (count > 0) {
          <ion-badge color="warning">{{ count }}</ion-badge>
        }
      }
    </div>
  `,
  styles: [
    `
      /* Breathing room so the icon + count never collide with the screen edge
         or the status-bar icons in the top-right of the header. */
      :host {
        display: inline-flex;
        align-items: center;
        padding-inline: 6px 14px;
      }
      .sync-status {
        position: relative;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        font-size: 1.5rem;
      }
      .sync-status ion-icon {
        color: var(--ion-text-color);
      }
      .sync-status ion-badge {
        position: absolute;
        top: -8px;
        right: -8px;
        min-width: 18px;
        height: 18px;
        padding: 0 5px;
        border-radius: 999px;
        font-size: 0.62rem;
        font-weight: 700;
        line-height: 18px;
        text-align: center;
        /* Ring in the header colour lifts the count clear of the icon behind it */
        box-shadow: 0 0 0 2px var(--ion-toolbar-background, #fff);
      }
      .spin ion-icon {
        animation: spin 1.2s linear infinite;
      }
      @keyframes spin {
        from {
          transform: rotate(0deg);
        }
        to {
          transform: rotate(360deg);
        }
      }
    `,
  ],
})
export class SyncStatusComponent {
  state$ = this.sync.state$;
  pendingCount$ = this.sync.pendingCount$;

  constructor(private sync: SyncService) {
    addIcons({ cloudDoneOutline, syncOutline, cloudUploadOutline, warningOutline, cloudOfflineOutline });
  }

  iconFor(state: string | null): string {
    switch (state) {
      case 'synced':
        return 'cloud-done-outline';
      case 'syncing':
        return 'sync-outline';
      case 'pending':
        return 'cloud-upload-outline';
      case 'failed':
        return 'warning-outline';
      case 'offline':
        return 'cloud-offline-outline';
      default:
        return 'cloud-done-outline';
    }
  }
}
