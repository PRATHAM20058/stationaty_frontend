import { Routes } from '@angular/router';
import { TabsPage } from './tabs.page';
import { authGuard } from '../core/guards/auth.guard';

export const routes: Routes = [
  {
    path: 'tabs',
    component: TabsPage,
    canActivate: [authGuard],
    children: [
      {
        path: 'dashboard',
        loadComponent: () => import('../pages/dashboard/dashboard.page').then((m) => m.DashboardPage),
      },
      {
        path: 'items',
        loadComponent: () => import('../pages/items/items.page').then((m) => m.ItemsPage),
      },
      {
        path: 'billing',
        loadComponent: () => import('../pages/billing/billing.page').then((m) => m.BillingPage),
      },
      {
        path: 'reports',
        loadComponent: () => import('../pages/reports/reports.page').then((m) => m.ReportsPage),
      },
      {
        path: 'bill-history',
        loadComponent: () => import('../pages/bill-history/bill-history.page').then((m) => m.BillHistoryPage),
      },
      {
        path: '',
        redirectTo: '/tabs/dashboard',
        pathMatch: 'full',
      },
    ],
  },
  {
    path: '',
    redirectTo: '/tabs/dashboard',
    pathMatch: 'full',
  },
];
