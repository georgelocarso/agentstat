import type { AgentEvent, SessionState } from '@agentstat/shared';
import type { SessionRegistry } from '../registry.js';
import {
  ACTIVITY_LOG_LINES,
  ACTIVITY_WINDOW,
  type HermesRunner,
  HermesCommandError,
  LOG_MISSING,
  ProbeCache,
  SESSION_LIMIT,
  defaultHermesRunner,
  mapLimit,
  resolveHermesBinary,
} from './commands.js';
import {
  PROFILE_NAME,
  type ActivityKind,
  type HermesProfile,
  classifyActivity,
  parseProfiles,
  parseSessions,
} from './parse.js';
import { snippet } from './redact.js';

const PROFILE_CACHE_TTL_MS = 30_000;
const ACTIVITY_CACHE_TTL_MS = 5_000;
const PROBE_CONCURRENCY = 4;
const NOT_INSTALLED_RETRY_MS = 30 * 60 * 1000;

export interface HermesWatcherOptions {
  /** Heartbeat cadence. */
  pollIntervalMs?: number;
  /** Explicit binary path (skips PATH resolution). */
  hermesBinary?: string;
  /** Injectable runner (stubbed in tests); receives the exact argv to run. */
  run?: HermesRunner;
  activityCacheTtlMs?: number;
  profileCacheTtlMs?: number;
}

interface HermesFacts {
  gateway: 'running' | 'stopped' | 'unknown';
  active: boolean;
  kind?: ActivityKind;
  label?: string;
  message?: string;
  sessionTitle?: string;
  logsAvailable: boolean;
  sessionsAvailable: boolean;
}

const noLogs: { ok: boolean; output: string } = { ok: false, output: '' };

/**
 * Monitoring-only collector for the Hermes Agent. Discovers every Hermes
 * profile via `hermes profile list`, probes each profile's recent agent log
 * window and session list, and emits one stable AgentStat session per profile
 * (`hermes:<profile>`). It never writes to Hermes, never schedules work and
 * never starts or resumes an agent: Hermes activity keeps coming from the
 * human at the agent's own CLI.
 */
export class HermesWatcher {
  private registry: SessionRegistry;
  private pollIntervalMs: number;
  private cache = new ProbeCache();
  private timer?: NodeJS.Timeout;
  private run?: HermesRunner;
  private runner?: HermesRunner;
  private activityCacheTtlMs: number;
  private profileCacheTtlMs: number;
  private seenProfiles: HermesProfile[] = [];
  private stopping = false;

  constructor(registry: SessionRegistry, options: HermesWatcherOptions = {}) {
    this.registry = registry;
    this.pollIntervalMs = options.pollIntervalMs ?? 15_000;
    this.activityCacheTtlMs = options.activityCacheTtlMs ?? ACTIVITY_CACHE_TTL_MS;
    this.profileCacheTtlMs = options.profileCacheTtlMs ?? PROFILE_CACHE_TTL_MS;
    if (options.run) {
      this.run = options.run;
    } else if (options.hermesBinary) {
      this.adoptBinary(options.hermesBinary);
    }
  }

  start(): void {
    if (!this.readyToRun()) {
      const resolved = resolveHermesBinary();
      if (!resolved) {
        console.log('[watcher] hermes CLI not found on PATH — hermes collector disabled (retrying every 30 min)');
        this.timer = setInterval(() => this.probeInstall(), NOT_INSTALLED_RETRY_MS);
        this.timer.unref?.();
        return;
      }
      this.adoptBinary(resolved);
      console.log('[watcher] Automatic Hermes monitoring active (read-only profile probes)');
    }
    this.timer = setInterval(() => void this.tick(), this.pollIntervalMs);
    this.timer.unref?.();
    void this.tick();
  }

  stop(): void {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    this.cache.clear();
  }

  /** Heartbeat: refresh discovery, then per-profile activity probes. */
  async tick(): Promise<void> {
    if (this.stopping) return;
    if (!this.run && !this.runner) {
      const resolved = resolveHermesBinary();
      if (!resolved) return;
      this.adoptBinary(resolved);
    }
    try {
      const profiles = await this.readProfiles();
      if (!profiles) {
        for (const profile of this.seenProfiles) this.recordStale(profile.name, 'Profiles unavailable');
        return;
      }
      this.seenProfiles = profiles;
      const names = profiles.map((profile) => profile.name).filter((name) => PROFILE_NAME.test(name));
      await mapLimit(names, PROBE_CONCURRENCY, async (name) => {
        const facts = await this.readFacts(name);
        const gateway = profiles.find((profile) => profile.name === name)?.gateway ?? 'unknown';
        this.recordFacts(name, gateway, facts);
      });
    } catch (error) {
      console.log(`[watcher] hermes probe failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private readyToRun(): boolean {
    return !!(this.run || this.runner);
  }

  private adoptBinary(binary: string): void {
    this.runner = defaultHermesRunner(binary);
  }

  private probeInstall(): void {
    if (this.run || this.runner) {
      if (this.timer) clearInterval(this.timer);
      return;
    }
    const resolved = resolveHermesBinary();
    if (resolved) {
      this.adoptBinary(resolved);
      if (this.timer) clearInterval(this.timer);
      console.log('[watcher] hermes CLI detected — hermes collector enabled');
      void this.tick();
    }
  }

  private exec(args: string[]): Promise<string> {
    if (this.run) return this.run(args);
    if (!this.runner) return Promise.reject(new HermesCommandError('hermes is not configured.', 'NOT_INSTALLED'));
    return this.runner(args);
  }

  private async readProfiles(): Promise<HermesProfile[] | undefined> {
    try {
      return parseProfiles(await this.cache.get('profiles', this.profileCacheTtlMs, () => this.exec(['profile', 'list'])));
    } catch {
      return undefined; // caller emits stale for previously seen profiles
    }
  }

  private async readFacts(profile: string): Promise<HermesFacts> {
    const logsPromise = this.cache.get(`logs:${profile}`, this.activityCacheTtlMs, () =>
      this.exec(['-p', profile, 'logs', 'agent', '-n', String(ACTIVITY_LOG_LINES), '--since', ACTIVITY_WINDOW]),
    );
    const sessionsPromise = this.cache.get(`sessions:${profile}`, this.activityCacheTtlMs, () =>
      this.exec(['-p', profile, 'sessions', 'list', '--limit', String(SESSION_LIMIT)]),
    );

    const [logs, sessions] = await Promise.all([
      logsPromise.then((output) => ({ ok: true, output }), (error: unknown) => {
        // A missing agent.log is an expected empty state (no work done yet), not a failure.
        if (error instanceof HermesCommandError && LOG_MISSING.test(error.stdout)) return { ok: true, output: '' };
        return noLogs;
      }),
      sessionsPromise.then((output) => ({ ok: true, output }), () => noLogs),
    ]);

    if (!logs.ok && !sessions.ok) {
      // Both probes failed; ProbeCache already evicted the failed keys, so the
      // next heartbeat retries cleanly without flushing unrelated fresh caches.
      return { gateway: 'unknown', active: false, logsAvailable: false, sessionsAvailable: false };
    }

    let sessionList: ReturnType<typeof parseSessions> = [];
    if (sessions.ok) {
      try {
        sessionList = parseSessions(sessions.output);
      } catch {
        sessionList = [];
      }
    }

    let activity = { active: false } as ReturnType<typeof classifyActivity>;
    if (logs.ok) {
      try {
        activity = classifyActivity(logs.output, sessions.ok ? sessions.output : undefined);
      } catch {
        activity = { active: false };
      }
    }

    return {
      gateway: 'unknown',
      active: activity.active,
      ...(activity.kind ? { kind: activity.kind, label: activity.label } : {}),
      ...(activity.message ? { message: activity.message } : {}),
      ...(sessionList[0]?.title ? { sessionTitle: sessionList[0].title } : {}),
      logsAvailable: logs.ok,
      sessionsAvailable: sessions.ok,
    };
  }

  private recordFacts(name: string, gateway: 'running' | 'stopped' | 'unknown', facts: HermesFacts): void {
    let state: SessionState;
    let outputSnippet: string | undefined;
    if (!facts.logsAvailable && !facts.sessionsAvailable) {
      state = 'stale';
      outputSnippet = 'Not Available';
    } else if (facts.active) {
      state = 'working';
      outputSnippet = facts.message ? snippet(facts.message) : snippet(facts.label ?? 'Active');
    } else {
      state = 'idle';
      // A stopped gateway does not make an agent offline; show it as a note only.
      outputSnippet = snippet(gateway === 'stopped' ? 'On a break · gateway stopped' : 'On a break');
    }

    const event: AgentEvent = {
      eventId: `hermes_${name}_${Date.now()}`,
      sessionId: `hermes:${name}`,
      agentType: 'hermes',
      state,
      project: name,
      displayPath: `~/.hermes/profiles/${name}`,
      promptSnippet: facts.sessionTitle ? snippet(facts.sessionTitle) : undefined,
      outputSnippet,
      timestamp: new Date().toISOString(),
    };
    this.registry.recordEvent(event);
  }

  private recordStale(name: string, reason: string): void {
    const event: AgentEvent = {
      eventId: `hermes_${name}_${Date.now()}`,
      sessionId: `hermes:${name}`,
      agentType: 'hermes',
      state: 'stale',
      project: name,
      displayPath: `~/.hermes/profiles/${name}`,
      outputSnippet: snippet(reason),
      timestamp: new Date().toISOString(),
    };
    this.registry.recordEvent(event);
  }
}
