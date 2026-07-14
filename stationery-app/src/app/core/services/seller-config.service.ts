import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { Preferences } from '@capacitor/preferences';
import { SellerConfig, DEFAULT_SELLER_CONFIG } from '../models/seller-config.model';

const SELLER_CONFIG_KEY = 'seller_config';

/**
 * Single source of truth for the shop's own GST/business identity. Persisted in Capacitor
 * Preferences so it survives SqliteService.clearUserData() (which wipes the domain cache on
 * login/logout) -- the seller profile is a device/app setting, not per-user cached data.
 */
@Injectable({ providedIn: 'root' })
export class SellerConfigService {
  private readonly subject = new BehaviorSubject<SellerConfig>(DEFAULT_SELLER_CONFIG);
  /** Latest seller config; seeded with the default until the stored value loads. */
  readonly config$ = this.subject.asObservable();

  private loaded: Promise<void>;

  constructor() {
    this.loaded = this.restore();
  }

  private async restore(): Promise<void> {
    const { value } = await Preferences.get({ key: SELLER_CONFIG_KEY });
    if (value) {
      try {
        // Merge over the default so a stored config missing a newly-added field stays valid.
        this.subject.next({ ...DEFAULT_SELLER_CONFIG, ...(JSON.parse(value) as Partial<SellerConfig>) });
      } catch {
        // Corrupt value -- fall back to the seed default already in the subject.
      }
    }
  }

  /** Current seller config (waits for the initial restore to finish). */
  async get(): Promise<SellerConfig> {
    await this.loaded;
    return this.subject.value;
  }

  /** Synchronous snapshot for templates; may briefly be the default before restore completes. */
  get current(): SellerConfig {
    return this.subject.value;
  }

  async save(config: SellerConfig): Promise<void> {
    await Preferences.set({ key: SELLER_CONFIG_KEY, value: JSON.stringify(config) });
    this.subject.next(config);
  }
}
