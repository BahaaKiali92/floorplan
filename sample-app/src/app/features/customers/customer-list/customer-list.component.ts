import { Component } from '@angular/core';
import { CustomersService } from '../data-access/customers.service';
import { CustomerExportService } from './customer-export.service';
@Component({
  selector: 'app-customer-list',
  standalone: true,
  templateUrl: './customer-list.component.html',
})
export class CustomerListComponent {}
