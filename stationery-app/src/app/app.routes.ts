import { Routes } from '@angular/router';
import { authGuard } from './core/guards/auth.guard';

export const routes: Routes = [
  {
    path: 'login',
    loadComponent: () => import('./pages/login/login.page').then((m) => m.LoginPage),
  },
  {
    path: 'signup',
    loadComponent: () => import('./pages/signup/signup.page').then((m) => m.SignupPage),
  },
  {
    path: '',
    loadChildren: () => import('./tabs/tabs.routes').then((m) => m.routes),
  },
  {
    path: 'categories',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/categories/categories.page').then((m) => m.CategoriesPage),
  },
  {
    path: 'items/new',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/items/item-form/item-form.page').then((m) => m.ItemFormPage),
  },
  {
    path: 'items/:id/edit',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/items/item-form/item-form.page').then((m) => m.ItemFormPage),
  },
  {
    path: 'items/:id',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/items/item-detail/item-detail.page').then((m) => m.ItemDetailPage),
  },
  {
    path: 'pending-bills',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/pending-bills/pending-bills.page').then((m) => m.PendingBillsPage),
  },
  {
    path: 'bills/:id',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/bill-detail/bill-detail.page').then((m) => m.BillDetailPage),
  },
  {
    path: 'settings',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/settings/settings.page').then((m) => m.SettingsPage),
  },
];
