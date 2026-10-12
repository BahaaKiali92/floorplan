import { Component } from '@angular/core';
import { CardComponent } from '@shared/ui/card/card.component';
import { OrderStatusBadgeComponent } from '../order-status-badge/order-status-badge.component';
@Component({
  selector: 'app-order-card',
  standalone: true,
  templateUrl: './order-card.component.html',
})
export class OrderCardComponent {}
