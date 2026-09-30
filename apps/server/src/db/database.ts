import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

/**
 * WebUI-owned SQLite database (Phase 1 auth, spec 2.2).
 *
 * This database holds ONLY WebUI state (users, sessions, bootstrap, audit).
 * It is never mixed with Hermes' own state database.
 */

export interface DatabaseHandles {
  db: Database.Database;
  file: string;
}

interface Migration {
  id: number;
  name: string;
  sql: string;
}

const MIGRATIONS: Migration[] = [
  {
    id: 1,
    name: 'initial-auth-schema',
    sql: `
      CREATE TABLE users (
        id                   TEXT PRIMARY KEY,
        username             TEXT NOT NULL,
        username_normalized  TEXT NOT NULL UNIQUE,
        display_name         TEXT,
        password_hash        TEXT NOT NULL,
        role                 TEXT NOT NULL DEFAULT 'owner',
        created_at           INTEGER NOT NULL,
        updated_at           INTEGER NOT NULL,
        password_changed_at  INTEGER NOT NULL,
        disabled_at          INTEGER
      );

      CREATE TABLE sessions (
        id                  TEXT PRIMARY KEY,
        token_hash          TEXT NOT NULL UNIQUE,
        user_id             TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        csrf_token          TEXT NOT NULL,
        created_at          INTEGER NOT NULL,
        last_seen_at        INTEGER NOT NULL,
        idle_expires_at     INTEGER NOT NULL,
        absolute_expires_at INTEGER NOT NULL,
        reauth_until        INTEGER,
        user_agent          TEXT,
        client_ip_hash      TEXT,
        revoked_at          INTEGER
      );
      CREATE INDEX idx_sessions_user ON sessions(user_id);
      CREATE INDEX idx_sessions_active ON sessions(revoked_at) WHERE revoked_at IS NULL;

      CREATE TABLE auth_bootstrap (
        id         INTEGER PRIMARY KEY CHECK (id = 1),
        token_hash TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        fingerprint TEXT
      );

      CREATE TABLE auth_audit (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp       INTEGER NOT NULL,
        user_id         TEXT,
        event           TEXT NOT NULL,
        outcome         TEXT NOT NULL,
        client_ip_hash  TEXT,
        user_agent      TEXT,
        metadata_json   TEXT,
        request_id      TEXT
      );
      CREATE INDEX idx_audit_event ON auth_audit(event, timestamp);
    `,
  },
  {
    id: 2,
    name: 'hermes-dashboard-tokens',
    // Auth mode "hermes": the dashboard session obtained at sign-in, used
    // server-side as the bearer for dashboard API calls. Single row.
    sql: `
      CREATE TABLE hermes_tokens (
        id                 INTEGER PRIMARY KEY CHECK (id = 1),
        access_token       TEXT NOT NULL,
        refresh_token      TEXT,
        access_expires_at  INTEGER,
        updated_at         INTEGER NOT NULL
      );
    `,
  },
];

export function openDatabase(dataDir: string): DatabaseHandles {
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const file = path.join(dataDir, 'webui.sqlite3');
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  migrate(db);
  // Best-effort private permissions on the database files.
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      fs.chmodSync(file + suffix, 0o600);
    } catch {
      // file may not exist (wal/shm are created lazily)
    }
  }
  return { db, file };
}

function migrate(db: Database.Database): void {
  db.exec(
    'CREATE TABLE IF NOT EXISTS schema_migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at INTEGER NOT NULL)',
  );
  const applied = new Set(
    (db.prepare('SELECT id FROM schema_migrations').all() as { id: number }[]).map((row) => row.id),
  );
  const insert = db.prepare('INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)');
  for (const migration of MIGRATIONS) {
    if (applied.has(migration.id)) {
      continue;
    }
    const run = db.transaction(() => {
      db.exec(migration.sql);
      insert.run(migration.id, migration.name, Date.now());
    });
    run();
  }
}
