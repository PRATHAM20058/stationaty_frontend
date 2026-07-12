import { Injectable } from '@angular/core';
import { SqliteService } from './sqlite.service';

export interface StoredUser {
  id: string;
  name: string;
  username: string;
  role: string;
}

const DEFAULT_ADMIN = { username: 'admin', password: 'admin123', name: 'Admin', role: 'owner' };

/**
 * Local (on-device) user accounts -- there's no backend yet, so signup/login are
 * validated entirely against a SQLite table. Passwords are SHA-256 hashed (via
 * Web Crypto) rather than stored in plain text; this is fine for an offline demo
 * store but isn't a substitute for real server-side auth once a backend exists.
 */
@Injectable({ providedIn: 'root' })
export class UserStoreService {
  constructor(private sqlite: SqliteService) {}

  /** Seeds the default admin/admin123 account the first time the app runs. */
  async ensureSeeded(): Promise<void> {
    const rows = await this.sqlite.query(`SELECT COUNT(*) as cnt FROM auth_users`);
    if ((rows[0]?.cnt ?? 0) > 0) return;

    const passwordHash = await hashPassword(DEFAULT_ADMIN.password);
    await this.sqlite.run(
      `INSERT INTO auth_users (id, name, username, password_hash, role) VALUES (?, ?, ?, ?, ?)`,
      ['user-admin', DEFAULT_ADMIN.name, DEFAULT_ADMIN.username, passwordHash, DEFAULT_ADMIN.role],
    );
  }

  async findByUsername(username: string): Promise<(StoredUser & { passwordHash: string }) | undefined> {
    const rows = await this.sqlite.query(`SELECT * FROM auth_users WHERE username = ?`, [username]);
    if (!rows.length) return undefined;
    const r = rows[0];
    return { id: r.id, name: r.name, username: r.username, role: r.role, passwordHash: r.password_hash };
  }

  async verifyPassword(username: string, password: string): Promise<StoredUser | undefined> {
    const user = await this.findByUsername(username);
    if (!user) return undefined;
    const hash = await hashPassword(password);
    if (hash !== user.passwordHash) return undefined;
    return { id: user.id, name: user.name, username: user.username, role: user.role };
  }

  async createUser(name: string, username: string, password: string, role = 'staff'): Promise<StoredUser> {
    const existing = await this.findByUsername(username);
    if (existing) {
      throw new Error('Username already taken');
    }
    const id = `user-${Date.now()}`;
    const passwordHash = await hashPassword(password);
    await this.sqlite.run(`INSERT INTO auth_users (id, name, username, password_hash, role) VALUES (?, ?, ?, ?, ?)`, [
      id,
      name,
      username,
      passwordHash,
      role,
    ]);
    return { id, name, username, role };
  }
}

async function hashPassword(password: string): Promise<string> {
  const data = new TextEncoder().encode(password);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
