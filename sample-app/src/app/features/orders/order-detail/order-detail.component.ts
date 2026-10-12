import { Component, inject } from '@angular/core';
import { OrdersService } from '../data-access/orders.service';
import { CustomerAvatarComponent } from '../../customers/ui/customer-avatar/customer-avatar.component';
import { EurPipe } from '@shared/pipes/eur.pipe';

@Component({
  selector: 'app-order-detail',
  standalone: true,
  templateUrl: './order-detail.component.html',
})
export class OrderDetailComponent {
  private orders = inject(OrdersService);
  order$ = this.orders.getOrder('1');
}
