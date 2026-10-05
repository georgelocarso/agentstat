import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readCursorStoreSnapshot } from './store-db.js';

let sqliteAvailable = true;
try {
  await import('node:sqlite');
} catch {
  sqliteAvailable = false;
}

const describeIf = sqliteAvailable ? describe : describe.skip;

describeIf('readCursorStoreSnapshot', () => {
  it('reads the hex meta row and newest readable message blobs', async () => {
    const { DatabaseSync } = await import('node:sqlite');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentstat-store-'));
    const dbPath = path.join(dir, 'store.db');

    const db = new DatabaseSync(dbPath);
    db.exec('CREATE TABLE blobs (id TEXT PRIMARY KEY, data BLOB);');
    db.exec('CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);');

    const meta = {
      agentId: 'f095fe79-e8b8-48a5-af2d-c86015cdd643',
      name: 'Merge Latest Preview',
      lastUsedModel: 'grok-4.6',
      approvalMode: 'unrestricted',
    };
    db.prepare('INSERT INTO meta (key, value) VALUES (?, ?)').run(
      '0',
      Buffer.from(JSON.stringify(meta), 'utf8').toString('hex')
    );
    db.prepare('INSERT INTO blobs (id, data) VALUES (?, ?)').run(
      'b1',
      Buffer.from(
        JSON.stringify({ role: 'user', content: '<user_info>\nWorkspace Path: C:/Data/Project/app\n</user_info>\nfix the tests' }),
        'utf8'
      )
    );
    db.prepare('INSERT INTO blobs (id, data) VALUES (?, ?)').run(
      'b2',
      Buffer.from(JSON.stringify({ role: 'assistant', content: [{ type: 'text', text: 'Done.' }] }), 'utf8')
    );
    // Encrypted payloads must be skipped, not crash the reader.
    db.prepare('INSERT INTO blobs (id, data) VALUES (?, ?)').run('b3', Buffer.from([0x00, 0xff, 0x10, 0x80, 0x1b]));
    db.close();

    const snapshot = await readCursorStoreSnapshot(dbPath);
    expect(snapshot?.meta?.agentId).toBe('f095fe79-e8b8-48a5-af2d-c86015cdd643');
    expect(snapshot?.meta?.lastUsedModel).toBe('grok-4.6');

    const roles = snapshot?.messages.map((message) => message.role);
    expect(roles).toEqual(['assistant', 'user']);
    expect(snapshot?.messages[1].workspace).toBe('C:/Data/Project/app');
    expect(snapshot?.messages[1].text).toContain('fix the tests');
  });

  it('returns null for unreadable databases', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentstat-store-'));
    const dbPath = path.join(dir, 'store.db');
    fs.writeFileSync(dbPath, 'not a database');
    expect(await readCursorStoreSnapshot(dbPath)).toBeNull();
  });
});
