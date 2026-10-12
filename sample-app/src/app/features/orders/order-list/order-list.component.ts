import { Component, inject } from '@angular/core';
import { OrdersStore } from '../data-access/orders.store';
import { OrdersService } from '../data-access/orders.service';
import { OrderCardComponent } from '../ui/order-card/order-card.component';
import { EmptyStateComponent } from '@shared/ui/empty-state/empty-state.component';

@Component({
  selector: 'app-order-list',
  standalone: true,
  templateUrl: './order-list.component.html',
})
export class OrderListComponent {
  readonly orders = inject(OrdersService);

  downloadCsv(): void {
    const csv = this.orders.exportCsv();
    console.log(csv);
  }
}
