import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '@env/environment';
@Injectable({ providedIn: 'root' })
export class ApiBaseService {
  private http = inject(HttpClient);
}
