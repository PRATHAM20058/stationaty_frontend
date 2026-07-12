import { Directive, ElementRef, HostListener } from '@angular/core';
import { focusNextField } from './form-navigation';

/**
 * Put on any ion-input/ion-textarea/ion-select. Pressing Enter moves focus to
 * the next field in the same form (opening it immediately if it's a select),
 * or submits the form if it was the last field.
 */
@Directive({
  selector: '[appEnterNext]',
  standalone: true,
})
export class EnterNextDirective {
  constructor(private el: ElementRef<HTMLElement>) {}

  @HostListener('keydown.enter', ['$event'])
  async onEnter(event: Event): Promise<void> {
    event.preventDefault();
    event.stopPropagation();
    await focusNextField(this.el.nativeElement);
  }
}
