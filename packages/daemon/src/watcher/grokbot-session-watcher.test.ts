import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { GrokBotSessionWatcher } from './grokbot-session-watcher.js';
import { SessionRegistry } from '../registry.js';
import { encodeSliceKey } from '../grokbot/slices.test.js';

const ACCOUNT = 'auth0|user_01ABC';

function makeAppData(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentstat-grokbot-app-'));
  fs.mkdirSync(path.join(dir, 'sand-client-persistence'), { recursive: true });
  return dir;
}

function writeSlice(appDataDir: string, key: string, value: unknown): string {
  const file = path.join(appDataDir, 'sand-client-persistence', `${encodeSliceKey(key)}.blob`);
  fs.writeFileSync(file, JSON.stringify(value));
  return file;
}

describe('GrokBotSessionWatcher', () => {
  const registries: SessionRegistry[] = [];

  afterEach(() => {
    for (const registry of registries) registry.stop();
    registries.length = 0;
  });

  function makeRegistry(): SessionRegistry {
    const registry = new SessionRegistry(60000, 60000);
    registries.push(registry);
    return registry;
  }

  it('discovers bots from the roster and derives prompt, output and state', () => {
    const appData = makeAppData();
    const botId = '12818fb2-5ba9-4639-9440-d22a14cd3ad5';
    writeSlice(appData, `sand.client.slice.account.${ACCOUNT}.roster.last-roster`, {
      schemaVersion: 4,
      value: {
        rows: [
          {
            id: botId,
            name: 'Implementor SuperFastDebuggingAndFixer',
            lastActivityAt: Date.now(),
            awaitingUserResponse: null,
          },
        ],
      },
    });
    writeSlice(appData, `sand.client.slice.account.${ACCOUNT}.transcript.replicas.${botId}`, {
      schemaVersion: 1,
      value: {
        entries: [
          { kind: 'send-message', message: { type: 'text', content: 'Previous reply' } },
          { kind: 'message', role: 'user', content: 'rerun full workflow automation test against preview' },
        ],
      },
    });

    const registry = makeRegistry();
    const watcher = new GrokBotSessionWatcher(registry, { appDataDir: appData });
    watcher.scan();

    const session = registry.getSession(`grokbot_${botId}`);
    expect(session).toBeDefined();
    expect(session?.agentType).toBe('grokbot');
    expect(session?.project).toBe('Implementor SuperFastDebuggingAndFixer');
    expect(session?.state).toBe('working');
    expect(session?.promptSnippet).toBe('rerun full workflow automation test against preview');
    expect(session?.outputSnippet).toBe('Previous reply');
  });

  it('skips bots whose activity predates the discovery window', () => {
    const appData = makeAppData();
    writeSlice(appData, `sand.client.slice.account.${ACCOUNT}.roster.last-roster`, {
      value: {
        rows: [
          { id: 'stale-bot', name: 'Old Bot', lastActivityAt: Date.now() - 30 * 24 * 60 * 60 * 1000 },
          { id: 'hidden-bot', name: 'Hidden Bot', lastActivityAt: Date.now(), isHiddenFromSidebar: true },
        ],
      },
    });

    const registry = makeRegistry();
    const watcher = new GrokBotSessionWatcher(registry, { appDataDir: appData });
    watcher.scan();

    expect(registry.getAllSessions()).toHaveLength(0);
  });

  it('reflects a new bot reply on the next scan', () => {
    const appData = makeAppData();
    const botId = 'bot-1';
    writeSlice(appData, `sand.client.slice.account.${ACCOUNT}.roster.last-roster`, {
      value: { rows: [{ id: botId, name: 'Reporter', lastActivityAt: Date.now() }] },
    });
    const replica = writeSlice(appData, `sand.client.slice.account.${ACCOUNT}.transcript.replicas.${botId}`, {
      value: { entries: [{ kind: 'message', role: 'user', content: 'write the report' }] },
    });

    const registry = makeRegistry();
    const watcher = new GrokBotSessionWatcher(registry, { appDataDir: appData, activityStreamMs: 0 });
    watcher.scan();
    expect(registry.getSession(`grokbot_${botId}`)?.state).toBe('working');

    fs.writeFileSync(
      replica,
      JSON.stringify({
        value: {
          entries: [
            { kind: 'message', role: 'user', content: 'write the report' },
            { kind: 'send-message', message: { type: 'text', content: 'The report is ready.' } },
          ],
        },
      })
    );
    const past = new Date(Date.now() - 10_000);
    fs.utimesSync(replica, past, past);

    watcher.scan();
    const session = registry.getSession(`grokbot_${botId}`);
    expect(session?.state).toBe('idle');
    expect(session?.outputSnippet).toBe('The report is ready.');
  });

  it('stays silent when the Grok Bot client never ran', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentstat-grokbot-empty-'));
    const registry = makeRegistry();
    const watcher = new GrokBotSessionWatcher(registry, { appDataDir: dir });
    watcher.scan();
    expect(registry.getAllSessions()).toHaveLength(0);
  });
});
