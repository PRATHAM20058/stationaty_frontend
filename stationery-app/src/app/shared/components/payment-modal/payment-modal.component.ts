import { Component, Input, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  IonHeader,
  IonToolbar,
  IonTitle,
  IonButtons,
  IonButton,
  IonContent,
  IonItem,
  IonLabel,
  IonInput,
  IonSegment,
  IonSegmentButton,
  IonText,
  ModalController,
} from '@ionic/angular/standalone';
import { PaymentMethod } from '../../../core/models/bill.model';
import { EnterNextDirective } from '../../directives/enter-next.directive';

/**
 * Replaces the old AlertController-based "Mark as Paid" / "Record Payment" dialogs.
 * Ionic's ion-alert cannot mix a number input with radio inputs in the same alert --
 * it silently renders the radios as unlabeled native inputs and always reports the
 * *last* radio's value, regardless of which one was tapped. This modal uses real
 * Ionic form components instead, so both fields work correctly together.
 */
@Component({
  selector: 'app-payment-modal',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    IonHeader,
    IonToolbar,
    IonTitle,
    IonButtons,
    IonButton,
    IonContent,
    IonItem,
    IonLabel,
    IonInput,
    IonSegment,
    IonSegmentButton,
    IonText,
    EnterNextDirective,
  ],
  templateUrl: './payment-modal.component.html',
})
export class PaymentModalComponent implements OnInit {
  /** 'full' marks the whole due amount as paid; 'partial' lets the user enter an amount up to the due. */
  @Input() mode: 'full' | 'partial' = 'partial';
  @Input() amountDue = 0;

  /** Empty until the user types — no prefilled 0 to clear. */
  amountReceived: number | null = null;
  paymentMethod: NonNullable<PaymentMethod> = 'cash';
  chequeNo = '';

  constructor(private modalController: ModalController) {}

  ngOnInit(): void {
    if (this.mode === 'full') {
      this.amountReceived = this.amountDue;
    }
  }

  get isValid(): boolean {
    return (this.amountReceived ?? 0) > 0 && (this.amountReceived ?? 0) <= this.amountDue;
  }

  cancel(): void {
    this.modalController.dismiss(null, 'cancel');
  }

  save(): void {
    if (!this.isValid) return;
    this.modalController.dismiss(
      {
        amount: this.amountReceived ?? 0,
        method: this.paymentMethod,
        chequeNo: this.paymentMethod === 'cheque' ? this.chequeNo.trim() || undefined : undefined,
      },
      'save',
    );
  }
}
