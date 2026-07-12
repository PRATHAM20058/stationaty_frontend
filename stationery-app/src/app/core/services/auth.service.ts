import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, firstValueFrom } from 'rxjs';
import { Preferences } from '@capacitor/preferences';
import { jwtDecode } from 'jwt-decode';
import { environment } from '../../../environments/environment';
import { User } from '../models/user.model';
import { DemoSeedService } from './demo-seed.service';
import { UserStoreService, StoredUser } from './user-store.service';

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
    private demoSeed: DemoSeedService,
    private userStore: UserStoreService,
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
   * No backend yet, so accounts (including the seeded admin/admin123) live in a
   * local SQLite table. A username not found locally falls through to the real
   * backend call, so this keeps working once a server is plugged in.
   */
  async login(username: string, password: string): Promise<User> {
    await this.userStore.ensureSeeded();

    const knownLocally = await this.userStore.findByUsername(username);
    if (knownLocally) {
      const verified = await this.userStore.verifyPassword(username, password);
      if (!verified) {
        throw { status: 401 };
      }
      return this.completeLocalLogin(verified);
    }

    const res = await firstValueFrom(
      this.http.post<LoginResponse>(`${environment.apiUrl}/auth/login`, { username, password }),
    );
    await Preferences.set({ key: TOKEN_KEY, value: res.token });
    await Preferences.set({ key: 'auth_user', value: JSON.stringify(res.user) });
    this.currentUserSubject.next(res.user);
    return res.user;
  }

  /** Creates a new local account and signs the user straight in. */
  async signup(name: string, username: string, password: string): Promise<User> {
    await this.userStore.ensureSeeded();
    const created = await this.userStore.createUser(name, username, password);
    return this.completeLocalLogin(created);
  }

  /** Signs a locally-verified user in (no HTTP call) and seeds sample data so the app is explorable. */
  private async completeLocalLogin(storedUser: StoredUser): Promise<User> {
    const user: User = { id: storedUser.id, name: storedUser.name, role: storedUser.role };
    const token = this.buildFakeToken(storedUser.id);
    await Preferences.set({ key: TOKEN_KEY, value: token });
    await Preferences.set({ key: 'auth_user', value: JSON.stringify(user) });
    this.currentUserSubject.next(user);
    await this.demoSeed.seedIfEmpty();
    return user;
  }

  private buildFakeToken(subject: string): string {
    const base64url = (obj: unknown) => btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const header = base64url({ alg: 'none', typ: 'JWT' });
    const payload = base64url({ sub: subject, exp: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60 });
    return `${header}.${payload}.local-signature`;
  }

  async logout(): Promise<void> {
    await Preferences.remove({ key: TOKEN_KEY });
    await Preferences.remove({ key: 'auth_user' });
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
