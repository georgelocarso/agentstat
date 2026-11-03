import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ACTIVITY_LABELS,
  type HermesProfile,
  PROFILE_NAME,
  classifyActivity,
  isSessionFresh,
  parseLogRecords,
  parseProfiles,
  parseSessions,
} from './parse.js';
import { HermesCommandError, mapLimit, resolveHermesBinary } from './commands.js';
import { HermesWatcher } from './hermes-watcher.js';
import { redact, snippet } from './redact.js';
import type { SessionRegistry } from '../registry.js';

// Fixtures captured verbatim from the local install (piped, 2026-11).

const PROFILE_LIST_FIXTURE = [
  '',
  ' Profile          Model                        Gateway      Alias        Distribution',
  ' ───────────────    ───────────────────────────    ───────────    ───────────    ────────────────────',
  ' ◆default         light-flash                  running      —            —',
  '',
].join('\n');

const SESSIONS_FIXTURE = [
  'Title                        Workspace          Last Active   ID',
  '──────────────────────────────────────────────────────────────────────────────────────────────────────────────',
  'Diagnose Tailscale SSH pol   GEORGE-KENNETH-2   6h ago        20261103_165411_cce404',
  'Update protected agent ins   —                  6h ago        20261103_165115_bd0488',
  'Document agent handover kn   kakai-platfrom-b   6h ago        20261103_134624_82e5df',
  '  … more not shown (use --limit 6 to see more)',
  '',
].join('\n');

const TELEGRAM_LOG_FIXTURE = [
  '--- ~/AppData/Local/hermes/logs/agent.log (last 20) ---',
  '2026-11-03 22:42:44,803 INFO plugins.platforms.telegram.telegram_network: [Telegram] Telegram API transport recovered via api.telegram.org after 149.154.166.110 failed: ConnectTimeout(\'\')',
  '2026-11-03 22:42:46,618 WARNING plugins.platforms.telegram.telegram_network: [Telegram] IPv4 Telegram API IP 149.154.166.110 failed: ConnectTimeout(\'\')',
  '2026-11-03 22:46:00,773 WARNING hermes_plugins.platforms__telegram.adapter: [Telegram] Telegram polling degraded (heartbeat probe); gateway stays alive and will retry. Error: <TimeoutError>',
  '2026-11-03 22:46:27,472 INFO hermes_plugins.platforms__telegram.adapter: [Telegram] Telegram polling recovered: getUpdates progressing (generation 5)',
  '',
].join('\r\n');

const CRON_LOG_FIXTURE = [
  '2026-11-03 21:05:00,001 INFO cron.daily-report: started daily report run',
  '2026-11-03 21:05:12,480 INFO cron.daily-report: finished with 2 deliverables',
  '',
].join('\n');

const THINKING_LOG_FIXTURE = [
  '2026-11-03 21:00:10,100 INFO agent.loop: planning next step for user request',
  '2026-11-03 21:00:14,900 INFO tools.shell: ran `git status`',
  '2026-11-03 21:00:15,001 INFO gateway.listener: inbound connection',
  '',
].join('\n');

describe('parseProfiles', () => {
  it('parses the real profile list: skips header/rule rows and decoration glyphs', () => {
    const profiles = parseProfiles(PROFILE_LIST_FIXTURE);
    expect(profiles).toEqual([{ name: 'default', model: 'light-flash', gateway: 'running' }] satisfies HermesProfile[]);
  });

  it('rejects names that are not option-safe for `hermes -p`', () => {
    expect(PROFILE_NAME.test('--port')).toBe(false);
    expect(PROFILE_NAME.test('-h')).toBe(false);
    expect(PROFILE_NAME.test('a'.repeat(64))).toBe(true);
    expect(PROFILE_NAME.test('a'.repeat(65))).toBe(false);
    expect(PROFILE_NAME.test('coder_2')).toBe(true);
  });

  it('deduplicates repeated rows', () => {
    expect(parseProfiles(`${PROFILE_LIST_FIXTURE}◆default         light-flash                  running      —            —\n`)).toHaveLength(1);
  });
});

describe('parseSessions', () => {
  it('parses the real session table and skips the footer line', () => {
    const sessions = parseSessions(SESSIONS_FIXTURE);
    expect(sessions).toHaveLength(3);
    expect(sessions[0]).toMatchObject({ title: 'Diagnose Tailscale SSH pol', workspace: 'GEORGE-KENNETH-2', lastActive: '6h ago', id: '20261103_165411_cce404' });
  });

  it('skips punctuation-placeholder filler rows so they never become titles', () => {
    const sessions = parseSessions('—   —   —   —\nReal session tit   workspacex   just now   20261103_999999_abc123\n');
    expect(sessions).toEqual([{ title: 'Real session tit', workspace: 'workspacex', lastActive: 'just now', id: '20261103_999999_abc123' }]);
  });

  it('freshness window: just now/minutes count, hours do not', () => {
    expect(isSessionFresh('just now')).toBe(true);
    expect(isSessionFresh('3m ago')).toBe(true);
    expect(isSessionFresh('4m ago')).toBe(false);
    expect(isSessionFresh('6h ago')).toBe(false);
  });
});

describe('log records and activity', () => {
  it('parses real log records, skipping the file banner', () => {
    const records = parseLogRecords(TELEGRAM_LOG_FIXTURE);
    expect(records).toHaveLength(4);
    expect(records[0].logger).toBe('plugins.platforms.telegram.telegram_network');
  });

  it('gateway/platform noise alone does not mark activity', () => {
    const activity = classifyActivity(TELEGRAM_LOG_FIXTURE);
    expect(activity.active).toBe(false);
    expect(activity.kind).toBeUndefined();
  });

  it('cron logger lines are activity', () => {
    const activity = classifyActivity(CRON_LOG_FIXTURE);
    expect(activity.active).toBe(true);
    expect(activity.kind).toBe('cron');
    expect(activity.label).toBe(ACTIVITY_LABELS.cron);
  });

  it('gateway lines combined with agent-loop lines mean chat', () => {
    const activity = classifyActivity(THINKING_LOG_FIXTURE);
    expect(activity.active).toBe(true);
    expect(activity.kind).toBe('chat');
    expect(activity.lastSeen).toBe('2026-11-03 21:00:15,001');
  });

  it('records the deciding log line as the activity message', () => {
    const activity = classifyActivity(THINKING_LOG_FIXTURE);
    expect(activity.message).toBe('inbound connection');
  });

  it('a fresh session can prove chat activity when logs are silent', () => {
    const sessions = SESSIONS_FIXTURE.replace(/6h ago/g, 'just now');
    const activity = classifyActivity('', sessions);
    expect(activity.active).toBe(true);
    expect(activity.kind).toBe('chat');
  });
});

describe('redact', () => {
  it('drops key-shaped secrets', () => {
    expect(redact('key sk-abcdEFGH12345678 leaked')).toBe('key [redacted] leaked');
    expect(redact('Authorization: Bearer abcdefghijklmnop')).toBe('Authorization: [redacted]');
  });

  it('shortens the home directory to ~', () => {
    const value = redact(`see ${os.homedir()}\\.hermes\\logs\\agent.log`);
    expect(value).toBe('see ~/.hermes/logs/agent.log');
  });

  it('caps snippet length', () => {
    expect(snippet('x'.repeat(300))).toHaveLength(200);
  });
});

describe('command plumbing', () => {
  it('resolveHermesBinary finds an artifact directory placed on PATH', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-path-'));
    const marker = 'hermes.test-artifact';
    fs.writeFileSync(path.join(dir, marker), 'placeholder');
    const previousPath = process.env.PATH;
    try {
      process.env.PATH = dir;
      expect(resolveHermesBinary([marker])).toBe(path.join(dir, marker));
    } finally {
      process.env.PATH = previousPath;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('resolveHermesBinary returns undefined when nothing matches', () => {
    const previousPath = process.env.PATH;
    try {
      process.env.PATH = '';
      expect(resolveHermesBinary(['hermes.definitely-not-here'])).toBeUndefined();
    } finally {
      process.env.PATH = previousPath;
    }
  });

  it('mapLimit rejects when a task throws', async () => {
    await expect(mapLimit([1, 2, 3], 2, async () => {
      throw new Error('probe failed');
    })).rejects.toThrow('probe failed');
  });

  it('mapLimit preserves input order with concurrency', async () => {
    const result = await mapLimit([4, 3, 2, 1], 2, async (value, index) => `${index}:${value}`);
    expect(result).toEqual(['0:4', '1:3', '2:2', '3:1']);
  });
});

describe('HermesWatcher', () => {
  type Run = (args: string[]) => Promise<string>;

  function makeRegistry() {
    const events: import('@agentstat/shared').AgentEvent[] = [];
    const registry = {
      recordEvent: (event: import('@agentstat/shared').AgentEvent) => events.push(event),
    } as unknown as SessionRegistry;
    return { events, registry };
  }

  const runnerFor = (calls: string[][], outputs: Record<string, string>, missingArgs?: string[]): Run => async (args) => {
    calls.push(args);
    const key = args.join(' ');
    if (missingArgs?.some((missing) => key.includes(missing))) {
      throw new HermesCommandError('Log file not found', 'COMMAND_FAILED');
    }
    return outputs[key] ?? '';
  };

  it('emits one stable session per profile with working/idle mapping', async () => {
    const { events, registry } = makeRegistry();
    const calls: string[][] = [];
    const run = runnerFor(calls, {
      'profile list': PROFILE_LIST_FIXTURE,
      '-p default logs agent -n 80 --since 3m': CRON_LOG_FIXTURE,
      '-p default sessions list --limit 3': SESSIONS_FIXTURE,
    });
    const watcher = new HermesWatcher(registry, { run });
    await watcher.tick();

    expect(events).toHaveLength(1);
    expect(events[0].sessionId).toBe('hermes:default');
    expect(events[0].agentType).toBe('hermes');
    expect(events[0].state).toBe('working');
    expect(events[0].outputSnippet).toContain('deliverables');
  });

  it('maps silent profiles to idle and marks a stopped gateway only as a note', async () => {
    const { events, registry } = makeRegistry();
    const stoppedList = PROFILE_LIST_FIXTURE.replace('running      ', 'stopped      ');
    const run = runnerFor([], {
      'profile list': stoppedList,
      '-p default logs agent -n 80 --since 3m': '',
      '-p default sessions list --limit 3': SESSIONS_FIXTURE,
    });
    await new HermesWatcher(registry, { run }).tick();

    expect(events[0].state).toBe('idle');
    expect(events[0].outputSnippet).toBe('On a break · gateway stopped');
  });

  it('when both probes fail the profile becomes stale, never crashed', async () => {
    const { events, registry } = makeRegistry();
    const run = async (args: string[]) => {
      if (args.join(' ').startsWith('profile list')) return PROFILE_LIST_FIXTURE;
      throw new HermesCommandError('boom', 'COMMAND_FAILED');
    };
    await new HermesWatcher(registry, { run }).tick();

    expect(events[0].state).toBe('stale');
    expect(events[0].outputSnippet).toBe('Not Available');
  });

  it('profile list failing marks previously seen profiles stale', async () => {
    const { events, registry } = makeRegistry();
    let healthy = true;
    const run: Run = async (args) => {
      if (args.join(' ').startsWith('profile list') && !healthy) throw new HermesCommandError('down', 'TIMEOUT');
      if (args.join(' ').startsWith('profile list')) return PROFILE_LIST_FIXTURE;
      return '';
    };
    const watcher = new HermesWatcher(registry, { run, profileCacheTtlMs: 0, activityCacheTtlMs: 0 });
    await watcher.tick();
    healthy = false;
    await watcher.tick();

    expect(events.at(-1)?.state).toBe('stale');
    expect(events.at(-1)?.outputSnippet).toBe('Profiles unavailable');
  });

  it('invocations stay on the fixed read-only allowlist', async () => {
    const { events, registry } = makeRegistry();
    const calls: string[][] = [];
    const run = runnerFor(calls, {
      'profile list': PROFILE_LIST_FIXTURE,
      '-p default logs agent -n 80 --since 3m': '',
      '-p default sessions list --limit 3': SESSIONS_FIXTURE,
    });
    await new HermesWatcher(registry, { run }).tick();

    const allowed = [
      /^profile list$/,
      /^-p [A-Za-z0-9][A-Za-z0-9_.-]{0,63} logs agent -n 80 --since 3m$/,
      /^-p [A-Za-z0-9][A-Za-z0-9_.-]{0,63} sessions list --limit 3$/,
    ];
    for (const call of calls) {
      expect(allowed.some((pattern) => pattern.test(call.join(' ')))).toBe(true);
    }
    expect(events).toHaveLength(1);
  });
});
