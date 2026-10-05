import fs from 'node:fs';
import { decodeCursorStoreMeta, parseCursorMessageBlob, type CursorStoreMessage, type CursorStoreMeta } from './events.js';

const SQLITE_MAGIC = 'SQLite format 3\u0000';

/** Guards against locked/partial/corrupt files before handing them to SQLite. */
function hasSqliteHeader(dbPath: string): boolean {
  try {
    const header = Buffer.alloc(16);
    const fd = fs.openSync(dbPath, 'r');
    try {
      fs.readSync(fd, header, 0, header.length, 0);
    } finally {
      fs.closeSync(fd);
    }
    return header.toString('latin1') === SQLITE_MAGIC;
  } catch {
    return false;
  }
}

/**
 * Read-only access to Cursor's per-chat SQLite store (`~/.cursor/chats/<hash>/<chat>/store.db`).
 *
 * The database is opened read-only and is only ever queried; we never write to Cursor's files.
 * `node:sqlite` requires Node >= 22.5 — on older runtimes the loader resolves to null and the
 * watcher degrades to `meta.json` metadata only.
 */

export interface CursorStoreSnapshot {
  meta: CursorStoreMeta | null;
  /** Newest readable (non-encrypted) message blobs, most recent first. */
  messages: CursorStoreMessage[];
}

type SqliteModule = typeof import('node:sqlite');

let sqliteModule: SqliteModule | null | undefined;

async function loadSqlite(): Promise<SqliteModule | null> {
  if (sqliteModule !== undefined) return sqliteModule;
  try {
    sqliteModule = await import('node:sqlite');
  } catch {
    sqliteModule = null;
  }
  return sqliteModule;
}

function toText(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (value instanceof Uint8Array) return Buffer.from(value).toString('utf8');
  return String(value);
}

export async function readCursorStoreSnapshot(dbPath: string, limit = 25): Promise<CursorStoreSnapshot | null> {
  if (!hasSqliteHeader(dbPath)) return null;

  const sqlite = await loadSqlite();
  if (!sqlite) return null;

  let db: InstanceType<SqliteModule['DatabaseSync']> | undefined;
  try {
    db = new sqlite.DatabaseSync(dbPath, { readOnly: true });

    let meta: CursorStoreMeta | null = null;
    try {
      const metaRows = db.prepare('SELECT key, value FROM meta').all() as Array<{ key: unknown; value: unknown }>;
      for (const row of metaRows) {
        const decoded = decodeCursorStoreMeta(row.value);
        if (decoded) {
          meta = decoded;
          break;
        }
      }
    } catch {
      // Older/unknown schemas: metadata is optional.
    }

    const messages: CursorStoreMessage[] = [];
    try {
      const rows = db
        .prepare('SELECT data FROM blobs ORDER BY rowid DESC LIMIT ?')
        .all(limit) as Array<{ data: unknown }>;
      for (const row of rows) {
        const parsed = parseCursorMessageBlob(toText(row.data));
        if (parsed) messages.push(parsed);
        if (messages.length >= 5) break;
      }
    } catch {
      // Blob layout may differ across Cursor versions.
    }

    return { meta, messages };
  } catch {
    // Locked, corrupted, or unreadable database — callers retry on the next poll.
    return null;
  } finally {
    try {
      db?.close();
    } catch {
      // ignore
    }
  }
}
