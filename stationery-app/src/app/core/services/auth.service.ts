import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, firstValueFrom } from 'rxjs';
import { Preferences } from '@capacitor/preferences';
import { jwtDecode } from 'jwt-decode';
import { environment } from '../../../environments/environment';
import { User } from '../models/user.model';
import { SqliteService } from './sqlite.service';

const TOKEN_KEY = 'auth_token';

interface LoginResponse {
  token: string;
  user: User;
}

interface DecodedToken {
  exp?: number;
  sub?: string;
  [key: string]: unknown;
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private currentUserSubject = new BehaviorSubject<User | null>(null);
  currentUser$ = this.currentUserSubject.asObservable();

  private restored: Promise<void>;

  constructor(
    private http: HttpClient,
    private sqlite: SqliteService,
  ) {
    this.restored = this.restoreSession();
  }

  private async restoreSession(): Promise<void> {
    const token = await this.getToken();
    if (!token || this.isExpired(token)) {
      return;
    }
    const cached = await Preferences.get({ key: 'auth_user' });
    if (cached.value) {
      this.currentUserSubject.next(JSON.parse(cached.value));
    }
  }

  whenRestored(): Promise<void> {
    return this.restored;
  }

  get currentUser(): User | null {
    return this.currentUserSubject.value;
  }

  /**
   * Authenticates against the backend, which is the source of truth for accounts and issues a
   * signed JWT. Data is per-user on the server, so we wipe the local (per-device) cache on every
   * sign-in — otherwise the previous user's cached rows would show until the next refresh.
   */
  async login(username: string, password: string): Promise<User> {
    const res = await firstValueFrom(
      this.http.post<LoginResponse>(`${environment.apiUrl}/auth/login`, { username, password }),
    );
    return this.establishSession(res);
  }

  /** Creates a new account on the backend and signs the user straight in (empty store). */
  async signup(name: string, username: string, password: string): Promise<User> {
    const res = await firstValueFrom(
      this.http.post<LoginResponse>(`${environment.apiUrl}/auth/signup`, { name, username, password }),
    );
    return this.establishSession(res);
  }

  /** Persists the session token/user and clears any cached data left by a previous account. */
  private async establishSession(res: LoginResponse): Promise<User> {
    await this.sqlite.clearUserData();
    await Preferences.set({ key: TOKEN_KEY, value: res.token });
    await Preferences.set({ key: 'auth_user', value: JSON.stringify(res.user) });
    this.currentUserSubject.next(res.user);
    return res.user;
  }

  async logout(): Promise<void> {
    await Preferences.remove({ key: TOKEN_KEY });
    await Preferences.remove({ key: 'auth_user' });
    // Drop the cached data so it can't be seen by whoever signs in next on this device.
    await this.sqlite.clearUserData();
    this.currentUserSubject.next(null);
  }

  async getToken(): Promise<string | null> {
    const res = await Preferences.get({ key: TOKEN_KEY });
    return res.value;
  }

  async isAuthenticated(): Promise<boolean> {
    const token = await this.getToken();
    return !!token && !this.isExpired(token);
  }

  private isExpired(token: string): boolean {
    try {
      const decoded = jwtDecode<DecodedToken>(token);
      if (!decoded.exp) return false;
      return Date.now() >= decoded.exp * 1000;
    } catch {
      return true;
    }
  }
}
