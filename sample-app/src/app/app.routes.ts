import { Routes } from '@angular/router';
import { authGuard } from '@core/auth/auth.guard';
export const routes: Routes = [
  { path: '', redirectTo: 'orders', pathMatch: 'full' },
  { path: 'orders', canActivate: [authGuard], loadChildren: () => import('./features/orders/orders.routes').then(m => m.ORDERS_ROUTES) },
  { path: 'customers', canActivate: [authGuard], loadChildren: () => import('./features/customers/customers.routes').then(m => m.CUSTOMERS_ROUTES) },
  { path: 'settings', loadComponent: () => import('./features/settings/settings-page/settings-page.component').then(m => m.SettingsPageComponent) },
];
