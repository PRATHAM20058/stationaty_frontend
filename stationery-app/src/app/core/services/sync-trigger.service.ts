import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';

/**
 * Decouples domain services (Category/Item/Billing) from SyncService.
 * Domain services enqueue writes into sqlite themselves, then call requestSync()
 * to nudge SyncService to try draining the queue right away instead of waiting
 * for the next network/resume/interval trigger. Avoids a circular DI dependency
 * between SyncService and the domain services it processes.
 */
@Injectable({ providedIn: 'root' })
export class SyncTriggerService {
  private trigger$ = new Subject<void>();
  onTrigger$ = this.trigger$.asObservable();

  requestSync(): void {
    this.trigger$.next();
  }
}
