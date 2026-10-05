import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { SessionSnapshot } from '@agentstat/shared';
import { GrokBotBridgeWatcher } from './grokbot-bridge-watcher.js';
import { SessionRegistry } from '../registry.js';

function makeTempHome(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'agentstat-grokbot-'));
}

function writeDaemon(home: string, daemon: Record<string, unknown>): void {
  fs.writeFileSync(path.join(home, 'local-exec-daemon.json'), JSON.stringify(daemon));
}

describe('GrokBotBridgeWatcher', () => {
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

  it('reports idle while the bridge heartbeats with no work in flight', () => {
    const home = makeTempHome();
    writeDaemon(home, { pid: 13988, startedAt: Date.now() - 60000, servingAt: Date.now(), inflightCount: 0 });
    fs.writeFileSync(
      path.join(home, 'local-exec-daemon.log'),
      '[sand-local-exec-daemon] started (pid 13988); serving local exec over the gateway\n'
    );

    const registry = makeRegistry();
    const watcher = new GrokBotBridgeWatcher(registry, { grokbotHome: home, minRefreshMs: 0 });
    watcher.scan();

    const session = registry.getSession('grokbot_local');
    expect(session).toBeDefined();
    expect(session?.agentType).toBe('grokbot');
    expect(session?.state).toBe('idle');
    expect(session?.pid).toBe(13988);
    expect(session?.outputSnippet).toContain('serving local exec over the gateway');
  });

  it('reports working while a bot executes locally', () => {
    const home = makeTempHome();
    writeDaemon(home, { pid: 42, startedAt: Date.now() - 5000, servingAt: Date.now(), inflightCount: 2 });
    fs.writeFileSync(path.join(home, 'local-exec-daemon.log'), '[shell-exec] running local command\n');

    const registry = makeRegistry();
    const watcher = new GrokBotBridgeWatcher(registry, { grokbotHome: home, minRefreshMs: 0 });
    watcher.scan();

    const session = registry.getSession('grokbot_local');
    expect(session?.state).toBe('working');
    expect(session?.outputSnippet).toContain('2 in flight');
  });

  it('marks the session stale when the heartbeat stops', () => {
    const home = makeTempHome();
    const now = Date.now();
    writeDaemon(home, { pid: 7, startedAt: now - 600000, servingAt: now, inflightCount: 0 });

    const registry = makeRegistry();
    const watcher = new GrokBotBridgeWatcher(registry, { grokbotHome: home, minRefreshMs: 0, staleAfterMs: 120000 });
    watcher.scan();
    expect(registry.getSession('grokbot_local')?.state).toBe('idle');

    // Simulate the bridge dying: heartbeat goes stale.
    writeDaemon(home, { pid: 7, startedAt: now - 600000, servingAt: now - 300000, inflightCount: 0 });
    watcher.scan();
    expect(registry.getSession('grokbot_local')?.state).toBe('stale');
    expect(registry.getSession('grokbot_local')?.outputSnippet).toContain('heartbeat lost');
  });

  it('does not create a session when the bridge was never seen', () => {
    const home = makeTempHome();
    const registry = makeRegistry();
    const watcher = new GrokBotBridgeWatcher(registry, { grokbotHome: home, minRefreshMs: 0 });
    watcher.scan();

    expect(registry.getAllSessions()).toHaveLength(0);
  });

  it('scrubs secrets from log snippets', () => {
    const home = makeTempHome();
    writeDaemon(home, { pid: 9, startedAt: Date.now(), servingAt: Date.now(), inflightCount: 1 });
    fs.writeFileSync(path.join(home, 'local-exec-daemon.log'), '[shell-exec] API_KEY=supersecretvalue123\n');

    const registry = makeRegistry();
    const watcher = new GrokBotBridgeWatcher(registry, { grokbotHome: home, minRefreshMs: 0 });
    watcher.scan();

    const snapshot = registry.getSession('grokbot_local') as SessionSnapshot;
    expect(snapshot?.outputSnippet).not.toContain('supersecretvalue123');
    expect(snapshot?.outputSnippet).toContain('[REDACTED]');
  });
});
