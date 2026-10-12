import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { ApiBaseService } from '@core/http/api-base.service';
@Injectable({ providedIn: 'root' })
export class CustomersService {
  private http = inject(HttpClient);
}
