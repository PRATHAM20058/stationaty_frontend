import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators, AbstractControl, ValidationErrors } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import {
  IonContent,
  IonItem,
  IonLabel,
  IonInput,
  IonButton,
  IonIcon,
  IonSpinner,
  IonText,
  ToastController,
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { storefrontOutline } from 'ionicons/icons';
import { AuthService } from '../../core/services/auth.service';
import { EnterNextDirective } from '../../shared/directives/enter-next.directive';

function passwordsMatchValidator(group: AbstractControl): ValidationErrors | null {
  const password = group.get('password')?.value;
  const confirmPassword = group.get('confirmPassword')?.value;
  return password && confirmPassword && password !== confirmPassword ? { passwordMismatch: true } : null;
}

@Component({
  selector: 'app-signup',
  standalone: true,
  templateUrl: './signup.page.html',
  styleUrls: ['./signup.page.scss'],
  imports: [
    CommonModule,
    ReactiveFormsModule,
    RouterLink,
    IonContent,
    IonItem,
    IonLabel,
    IonInput,
    IonButton,
    IonIcon,
    IonSpinner,
    IonText,
    EnterNextDirective,
  ],
})
export class SignupPage {
  loading = false;
  errorMessage = '';

  form: FormGroup = this.fb.group(
    {
      name: ['', [Validators.required]],
      username: ['', [Validators.required, Validators.minLength(3)]],
      password: ['', [Validators.required, Validators.minLength(6)]],
      confirmPassword: ['', [Validators.required]],
    },
    { validators: passwordsMatchValidator },
  );

  constructor(
    private fb: FormBuilder,
    private auth: AuthService,
    private router: Router,
    private toastController: ToastController,
  ) {
    addIcons({ storefrontOutline });
  }

  async submit(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      if (this.form.errors?.['passwordMismatch']) {
        this.errorMessage = 'Passwords do not match';
      }
      return;
    }
    this.loading = true;
    this.errorMessage = '';
    try {
      const { name, username, password } = this.form.getRawValue();
      await this.auth.signup(name!, username!, password!);
      // Full reload so every cached tab page is rebuilt for the new (empty) account.
      window.location.href = '/';
    } catch (err: any) {
      const taken = err?.status === 409 || err?.error?.message === 'Username already taken';
      this.errorMessage = taken
        ? 'That username is already taken'
        : err?.status === 0
          ? 'Could not reach the server. Check your connection.'
          : 'Could not create account';
      const toast = await this.toastController.create({ message: this.errorMessage, duration: 2500, color: 'danger' });
      await toast.present();
    } finally {
      this.loading = false;
    }
  }
}
