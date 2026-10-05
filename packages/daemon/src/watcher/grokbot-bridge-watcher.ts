import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { AgentEvent, SessionState } from '@agentstat/shared';
import { scrubSecrets } from '@agentstat/shared';
import { SessionRegistry } from '../registry.js';
import {
  evaluateBridgeState,
  GROKBOT_STALE_AFTER_MS,
  parseBridgeDaemon,
  pickLogTailLine,
} from '../grokbot/bridge-events.js';

export interface GrokBotWatcherOptions {
  grokbotHome?: string;
  pollIntervalMs?: number;
  staleAfterMs?: number;
  minRefreshMs?: number;
}

/**
 * Tracks the Grok Bot desktop app's local-exec bridge (`~/.grokbot`) as a single
 * `grokbot` session. Chat content lives in xAI's cloud, so only local tool
 * execution and bridge liveness are observable.
 */
export class GrokBotBridgeWatcher {
  private home: string;
  private pollIntervalMs: number;
  private staleAfterMs: number;
  private minRefreshMs: number;
  private registry: SessionRegistry;
  private timer?: NodeJS.Timeout;
  private sessionId: string;
  private lastEventKey = '';
  private lastRecordedAtMs = 0;
  private hasSession = false;

  constructor(registry: SessionRegistry, options: GrokBotWatcherOptions = {}) {
    this.registry = registry;
    this.home = options.grokbotHome || process.env.GROKBOT_HOME || path.join(os.homedir(), '.grokbot');
    this.pollIntervalMs = options.pollIntervalMs || 5000;
    this.staleAfterMs = options.staleAfterMs ?? GROKBOT_STALE_AFTER_MS;
    this.minRefreshMs = options.minRefreshMs ?? 15_000;
    this.sessionId = 'grokbot_local';
  }

  public start(): void {
    this.scan();
    this.timer = setInterval(() => this.scan(), this.pollIntervalMs);
    this.timer.unref?.();
    console.log(`[watcher] Grok Bot local-exec bridge monitoring active (watching ${this.home})`);
  }

  public stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  public scan(): void {
    const nowMs = Date.now();
    const daemon = this.readDaemon();
    const logTailLine = this.readLogTailLine();

    if (!daemon && !this.hasSession) {
      // Bridge never seen on this machine; stay silent.
      return;
    }

    const evaluated = evaluateBridgeState({ daemon, nowMs, staleAfterMs: this.staleAfterMs, logTailLine });
    if (evaluated.outputSnippet) {
      evaluated.outputSnippet = scrubSecrets(evaluated.outputSnippet).slice(0, 240);
    }

    const heartbeat = daemon?.servingAt ?? 0;
    const eventKey = `${evaluated.state}|${heartbeat}|${evaluated.outputSnippet || ''}`;
    const refreshDue = nowMs - this.lastRecordedAtMs >= this.minRefreshMs;

    if (eventKey === this.lastEventKey && !refreshDue) return;

    this.lastEventKey = eventKey;
    this.lastRecordedAtMs = nowMs;
    this.hasSession = true;

    const event: AgentEvent = {
      eventId: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      sessionId: this.sessionId,
      agentType: 'grokbot',
      state: evaluated.state as SessionState,
      project: 'grokbot',
      displayPath: '~',
      outputSnippet: evaluated.outputSnippet,
      pid: daemon?.pid,
      timestamp: new Date(nowMs).toISOString(),
    };

    this.registry.recordEvent(event);
  }

  private readDaemon() {
    const daemonPath = path.join(this.home, 'local-exec-daemon.json');
    try {
      return parseBridgeDaemon(JSON.parse(fs.readFileSync(daemonPath, 'utf8')));
    } catch {
      return null;
    }
  }

  private readLogTailLine(): string | undefined {
    const logPath = path.join(this.home, 'local-exec-daemon.log');
    try {
      const stats = fs.statSync(logPath);
      const readBytes = Math.min(stats.size, 8192);
      const fd = fs.openSync(logPath, 'r');
      try {
        const buffer = Buffer.alloc(readBytes);
        fs.readSync(fd, buffer, 0, readBytes, stats.size - readBytes);
        return pickLogTailLine(buffer.toString('utf8'));
      } finally {
        fs.closeSync(fd);
      }
    } catch {
      return undefined;
    }
  }
}
