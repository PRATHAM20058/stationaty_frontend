import { Component, Input, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
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
  ModalController,
} from '@ionic/angular/standalone';
import { Category } from '../../core/models/category.model';
import { EnterNextDirective } from '../../shared/directives/enter-next.directive';

@Component({
  selector: 'app-category-form-modal',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    IonHeader,
    IonToolbar,
    IonTitle,
    IonButtons,
    IonButton,
    IonContent,
    IonItem,
    IonLabel,
    IonInput,
    EnterNextDirective,
  ],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-title>{{ category ? 'Edit Category' : 'Add Category' }}</ion-title>
        <ion-buttons slot="end">
          <ion-button (click)="dismiss()">Cancel</ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>
    <ion-content class="ion-padding">
      <form [formGroup]="form" (ngSubmit)="save()">
        <ion-item fill="outline">
          <ion-label position="stacked">Category name</ion-label>
          <ion-input formControlName="name" placeholder="e.g. Notebooks" appEnterNext></ion-input>
        </ion-item>
        <ion-button expand="block" class="ion-margin-top" type="submit" [disabled]="form.invalid">Save</ion-button>
      </form>
    </ion-content>
  `,
})
export class CategoryFormModalComponent implements OnInit {
  @Input() category?: Category;

  form = this.fb.group({
    name: ['', [Validators.required, Validators.minLength(2)]],
  });

  constructor(
    private fb: FormBuilder,
    private modalController: ModalController,
  ) {}

  ngOnInit(): void {
    if (this.category) {
      this.form.patchValue({ name: this.category.name });
    }
  }

  dismiss(): void {
    this.modalController.dismiss(null, 'cancel');
  }

  save(): void {
    if (this.form.invalid) return;
    this.modalController.dismiss({ name: this.form.getRawValue().name }, 'save');
  }
}
