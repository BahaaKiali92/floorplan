import { HttpInterceptorFn } from '@angular/common/http';
import { AuthService } from './auth.service';
export const authInterceptor: HttpInterceptorFn = (req, next) => next(req);
