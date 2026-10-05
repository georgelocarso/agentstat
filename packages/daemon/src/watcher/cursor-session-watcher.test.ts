import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CursorSessionWatcher } from './cursor-session-watcher.js';
import { SessionRegistry } from '../registry.js';

function makeTempCursorHome(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'agentstat-cursor-'));
}

function writeTranscript(home: string, slug: string, sessionId: string, lines: unknown[]): string {
  const dir = path.join(home, 'projects', slug, 'agent-transcripts', sessionId);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${sessionId}.jsonl`);
  fs.writeFileSync(file, lines.map((line) => JSON.stringify(line)).join('\n') + '\n');
  return file;
}

describe('CursorSessionWatcher', () => {
  const registries: SessionRegistry[] = [];

  afterEach(() => {
    for (const registry of registries) registry.stop();
    registries.length = 0;
  });

  it('discovers agent transcripts and maps working/idle states', async () => {
    const home = makeTempCursorHome();
    const sessionId = 'aea5656e-01c6-4633-a232-2fa5c3b173fe';
    const file = writeTranscript(home, 'c-Data-Project-woex-agentcore', sessionId, [
      {
        role: 'user',
        message: { content: [{ type: 'text', text: '<user_query>code review changes</user_query>' }] },
      },
    ]);

    const registry = new SessionRegistry(60000, 60000);
    registries.push(registry);
    const watcher = new CursorSessionWatcher(registry, { cursorHome: home, storeReader: async () => null });

    await watcher.scan();
    const session = registry.getSession(`cursor_${sessionId}`);
    expect(session).toBeDefined();
    expect(session?.agentType).toBe('cursor');
    expect(session?.state).toBe('working');
    expect(session?.promptSnippet).toBe('code review changes');

    // Append a completing assistant message; the transcript tail must flip the state.
    fs.appendFileSync(
      file,
      JSON.stringify({ role: 'assistant', message: { content: [{ type: 'text', text: 'Review complete.' }] } }) + '\n'
    );
    await watcher.scan();
    expect(registry.getSession(`cursor_${sessionId}`)?.state).toBe('idle');
    expect(registry.getSession(`cursor_${sessionId}`)?.outputSnippet).toBe('Review complete.');

    // A failed turn marks the session crashed.
    fs.appendFileSync(
      file,
      JSON.stringify({ type: 'turn_ended', status: 'error', error: 'usage limit reached' }) + '\n'
    );
    await watcher.scan();
    expect(registry.getSession(`cursor_${sessionId}`)?.state).toBe('crashed');
  });

  it('ignores subagent transcripts and dot-directories', async () => {
    const home = makeTempCursorHome();
    const parent = '11111111-1111-4111-8111-111111111111';
    writeTranscript(home, 'c-app', parent, [
      { role: 'user', message: { content: [{ type: 'text', text: '<user_query>main session</user_query>' }] } },
    ]);
    const subDir = path.join(home, 'projects', 'c-app', 'agent-transcripts', parent, 'subagents');
    fs.mkdirSync(subDir, { recursive: true });
    fs.writeFileSync(
      path.join(subDir, '22222222-2222-4222-8222-222222222222.jsonl'),
      JSON.stringify({ role: 'user', message: { content: [{ type: 'text', text: '<user_query>subagent</user_query>' }] } }) + '\n'
    );

    const registry = new SessionRegistry(60000, 60000);
    registries.push(registry);
    const watcher = new CursorSessionWatcher(registry, { cursorHome: home, storeReader: async () => null });
    await watcher.scan();

    expect(registry.getAllSessions()).toHaveLength(1);
    expect(registry.getAllSessions()[0].sessionId).toBe(`cursor_${parent}`);
  });

  it('skips historical transcripts outside the discovery window', async () => {
    const home = makeTempCursorHome();
    const sessionId = '33333333-3333-4333-8333-333333333333';
    const file = writeTranscript(home, 'c-old-project', sessionId, [
      { role: 'user', message: { content: [{ type: 'text', text: '<user_query>ancient session</user_query>' }] } },
    ]);
    const old = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    fs.utimesSync(file, old, old);

    const registry = new SessionRegistry(60000, 60000);
    registries.push(registry);
    const watcher = new CursorSessionWatcher(registry, { cursorHome: home, storeReader: async () => null });
    await watcher.scan();

    expect(registry.getAllSessions()).toHaveLength(0);
  });

  it('discovers CLI chat stores from meta.json plus store.db messages', async () => {
    const home = makeTempCursorHome();
    const chatId = 'f095fe79-e8b8-48a5-af2d-c86015cdd643';
    const chatDir = path.join(home, 'chats', '66f6344cb21fede0527adffa0cfa1e9d', chatId);
    fs.mkdirSync(chatDir, { recursive: true });
    fs.writeFileSync(
      path.join(chatDir, 'meta.json'),
      JSON.stringify({ schemaVersion: 1, createdAtMs: 1780556795393, hasConversation: true, title: 'Workflow Auditor', updatedAtMs: Date.now() })
    );
    fs.writeFileSync(path.join(chatDir, 'store.db'), 'placeholder');

    const registry = new SessionRegistry(60000, 60000);
    registries.push(registry);
    const watcher = new CursorSessionWatcher(registry, {
      cursorHome: home,
      storeReader: async () => ({
        meta: { name: 'Workflow Auditor', approvalMode: 'unrestricted', lastUsedModel: 'grok-4.6' },
        messages: [
          { role: 'assistant', text: 'Waiting for your next request.' },
          { role: 'user', text: 'Audit the workflow.' },
        ],
      }),
    });

    await watcher.scan();
    const session = registry.getSession(`cursor_${chatId}`);
    expect(session).toBeDefined();
    expect(session?.project).toBe('cursor-session');
    expect(session?.promptSnippet).toBe('Audit the workflow.');
    expect(session?.outputSnippet).toBe('Waiting for your next request.');
    // Newest readable message is an assistant message: the turn finished.
    expect(session?.state).toBe('idle');

    // A live store.db write (WAL mtime) with a trailing user message flips to working.
    fs.writeFileSync(path.join(chatDir, 'store.db-wal'), 'wal');
    await new Promise((resolve) => setTimeout(resolve, 15));
    const watcherBusy = new CursorSessionWatcher(registry, {
      cursorHome: home,
      storeReader: async () => ({
        meta: null,
        messages: [{ role: 'user', text: 'Now ship the fix.' }],
      }),
    });
    await watcherBusy.scan();
    expect(registry.getSession(`cursor_${chatId}`)?.state).toBe('working');
    expect(registry.getSession(`cursor_${chatId}`)?.promptSnippet).toBe('Now ship the fix.');
  });
});
