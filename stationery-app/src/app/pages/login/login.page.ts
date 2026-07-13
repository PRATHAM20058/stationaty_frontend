import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
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
import { storefrontOutline, personOutline, lockClosedOutline } from 'ionicons/icons';
import { AuthService } from '../../core/services/auth.service';
import { EnterNextDirective } from '../../shared/directives/enter-next.directive';

@Component({
  selector: 'app-login',
  standalone: true,
  templateUrl: './login.page.html',
  styleUrls: ['./login.page.scss'],
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
export class LoginPage {
  loading = false;
  errorMessage = '';

  form = this.fb.group({
    username: ['', [Validators.required]],
    password: ['', [Validators.required]],
  });

  constructor(
    private fb: FormBuilder,
    private auth: AuthService,
    private router: Router,
    private toastController: ToastController,
  ) {
    addIcons({ storefrontOutline, personOutline, lockClosedOutline });
  }

  fillDemoCredentials(): void {
    this.form.setValue({ username: 'admin', password: 'admin123' });
    this.submit();
  }

  async submit(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.loading = true;
    this.errorMessage = '';
    try {
      const { username, password } = this.form.getRawValue();
      await this.auth.login(username!, password!);
      // Full reload so every cached tab page is rebuilt for this user -- otherwise Ionic keeps
      // the previous user's dashboard/list instances alive and briefly shows their data.
      window.location.href = '/';
    } catch (err: any) {
      this.errorMessage = err?.status === 401 ? 'Invalid username or password' : 'Could not reach the server. Check your connection.';
      const toast = await this.toastController.create({ message: this.errorMessage, duration: 2500, color: 'danger' });
      await toast.present();
    } finally {
      this.loading = false;
    }
  }
}
