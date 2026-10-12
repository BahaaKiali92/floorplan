import { signal } from '@angular/core';
import { OrdersService } from './orders.service';
export class OrdersStore { orders = signal([]); }
