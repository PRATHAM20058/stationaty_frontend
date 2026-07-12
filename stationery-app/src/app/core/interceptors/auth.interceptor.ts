import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { from } from 'rxjs';
import { catchError, switchMap } from 'rxjs/operators';
import { AuthService } from '../services/auth.service';

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const router = inject(Router);

  // Login itself must not be blocked waiting on a token.
  if (req.url.includes('/auth/login')) {
    return next(req);
  }

  return from(auth.getToken()).pipe(
    switchMap((token) => {
      const authedReq = token ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } }) : req;
      return next(authedReq).pipe(
        catchError((err) => {
          if (err.status === 401) {
            auth.logout().then(() => router.navigateByUrl('/login'));
          }
          throw err;
        }),
      );
    }),
  );
};
