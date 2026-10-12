import { inject } from '@angular/core';
import { AuthService } from './auth.service';
export const authGuard = () => inject(AuthService);
