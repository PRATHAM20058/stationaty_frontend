import { Directive, OnDestroy } from '@angular/core';

/**
 * Put on any ion-select. While its picker (alert or popover interface) is open,
 * typing a letter jumps/scrolls to the first option whose label starts with
 * that letter -- pressing the same letter again cycles to the next match,
 * matching classic native <select> typeahead behavior.
 */
@Directive({
  selector: 'ion-select[appTypeaheadSelect]',
  standalone: true,
})
export class SelectTypeaheadDirective implements OnDestroy {
  private keyHandler?: (e: KeyboardEvent) => void;
  private lastKey = '';
  private cycleIndex = 0;

  private presentHandler = (): void => this.attach();
  private dismissHandler = (): void => this.detach();

  constructor() {
    document.addEventListener('ionPopoverDidPresent', this.presentHandler);
    document.addEventListener('ionAlertDidPresent', this.presentHandler);
    document.addEventListener('ionPopoverWillDismiss', this.dismissHandler);
    document.addEventListener('ionAlertWillDismiss', this.dismissHandler);
  }

  ngOnDestroy(): void {
    document.removeEventListener('ionPopoverDidPresent', this.presentHandler);
    document.removeEventListener('ionAlertDidPresent', this.presentHandler);
    document.removeEventListener('ionPopoverWillDismiss', this.dismissHandler);
    document.removeEventListener('ionAlertWillDismiss', this.dismissHandler);
    this.detach();
  }

  private attach(): void {
    this.detach();
    this.lastKey = '';
    this.cycleIndex = 0;
    this.keyHandler = (ke: KeyboardEvent) => this.onKeydown(ke);
    document.addEventListener('keydown', this.keyHandler);
  }

  private detach(): void {
    if (this.keyHandler) {
      document.removeEventListener('keydown', this.keyHandler);
      this.keyHandler = undefined;
    }
  }

  private onKeydown(ke: KeyboardEvent): void {
    if (ke.key.length !== 1 || !/[a-z0-9]/i.test(ke.key)) return;
    const letter = ke.key.toLowerCase();

    // Alert interface uses .alert-radio-label spans; popover interface uses ion-item rows.
    const items = Array.from(document.querySelectorAll('ion-alert .alert-radio-label, ion-popover ion-item')) as HTMLElement[];
    if (!items.length) return;

    const matches = items.filter((item) => item.textContent?.trim().toLowerCase().startsWith(letter));
    if (!matches.length) return;

    this.cycleIndex = letter === this.lastKey ? (this.cycleIndex + 1) % matches.length : 0;
    this.lastKey = letter;

    const target = matches[this.cycleIndex];
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    if (!target.hasAttribute('tabindex')) {
      target.setAttribute('tabindex', '-1');
    }
    target.focus({ preventScroll: true });
  }
}
