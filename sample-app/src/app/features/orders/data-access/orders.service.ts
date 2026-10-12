import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Order } from './order.model';
import { ApiBaseService } from '@core/http/api-base.service';
import { NotificationService } from '@core/notifications/notification.service';

@Injectable({ providedIn: 'root' })
export class OrdersService {
  private http = inject(HttpClient);
  private api = inject(ApiBaseService);
  private notifications = inject(NotificationService);
  private cache = signal<Order[]>([]);
  private exportCount = 0;

  getOrders() {
    return this.http.get<Order[]>(this.url('/orders'));
  }

  getOrder(id: string) {
    return this.http.get<Order>(this.url(`/orders/${id}`));
  }

  refresh(): void {
    this.getOrders().subscribe((orders) => this.cache.set(orders));
  }

  exportCsv(): string {
    this.exportCount++;
    return this.cache().map((o) => this.formatRow(o)).join('\n');
  }

  exportPdf(): void {
    const rows = this.cache().map((o) => this.formatRow(o));
    this.exportCount++;
    this.notifications.info(`Exported ${rows.length} orders`);
  }

  private formatRow(order: Order): string {
    return `${order.id};${this.formatMoney(order.total)}`;
  }

  private formatMoney(value: number): string {
    return value.toFixed(2) + ' EUR';
  }

  private url(path: string): string {
    return '/api' + path;
  }
}
