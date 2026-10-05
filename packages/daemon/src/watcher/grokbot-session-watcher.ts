import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { AgentEvent } from '@agentstat/shared';
import { SessionRegistry } from '../registry.js';
import {
  decodeSliceKey,
  deriveGrokBotSession,
  parseRoster,
  parseTranscriptReplica,
  type GrokBotRosterRow,
  type GrokBotTranscriptEntry,
} from '../grokbot/slices.js';

export interface GrokBotSessionWatcherOptions {
  /** Grok Bot desktop app data dir (the one containing `sand-client-persistence`). */
  appDataDir?: string;
  pollIntervalMs?: number;
  /** Only Bots with activity inside this window are imported on first discovery. */
  discoveryWindowMs?: number;
  /** Transcript writes inside this window count as active work (streaming replies). */
  activityStreamMs?: number;
}

const DEFAULT_DISCOVERY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export function defaultGrokBotAppDataDir(): string {
  const home = os.homedir();
  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'Grok Bot');
  }
  if (process.platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', 'Grok Bot');
  }
  return path.join(process.env.XDG_CONFIG_HOME || path.join(home, '.config'), 'Grok Bot');
}

interface BotWatch {
  eventKey: string;
  mtimeMs: number;
}

/**
 * Polls the Grok Bot desktop client's persistence slices to surface per-Bot sessions with
 * the last prompt, last reply and observable state. Chat history itself is cloud-side, so
 * state is derived from unanswered user messages, `awaitingUserResponse` and active
 * transcript writes.
 */
export class GrokBotSessionWatcher {
  private persistDir: string;
  private pollIntervalMs: number;
  private discoveryWindowMs: number;
  private activityStreamMs: number;
  private registry: SessionRegistry;
  private watches = new Map<string, BotWatch>();
  private timer?: NodeJS.Timeout;

  constructor(registry: SessionRegistry, options: GrokBotSessionWatcherOptions = {}) {
    this.registry = registry;
    this.persistDir = path.join(options.appDataDir || process.env.GROKBOT_APP_DATA || defaultGrokBotAppDataDir(), 'sand-client-persistence');
    this.pollIntervalMs = options.pollIntervalMs || 3000;
    this.discoveryWindowMs = options.discoveryWindowMs ?? DEFAULT_DISCOVERY_WINDOW_MS;
    this.activityStreamMs = options.activityStreamMs ?? 15_000;
  }

  public start(): void {
    this.scan();
    this.timer = setInterval(() => this.scan(), this.pollIntervalMs);
    this.timer.unref?.();
    console.log(`[watcher] Grok Bot session monitoring active (watching ${this.persistDir})`);
  }

  public stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  public scan(): void {
    const sliceFiles = this.listSliceFiles();
    if (sliceFiles.size === 0) return;

    const rosterFile = [...sliceFiles.entries()].find(([key]) => key.endsWith('roster.last-roster'));
    if (!rosterFile) return;

    let roster: GrokBotRosterRow[];
    try {
      roster = parseRoster(JSON.parse(fs.readFileSync(rosterFile[1], 'utf8')));
    } catch {
      return;
    }

    const nowMs = Date.now();
    for (const bot of roster) {
      if (bot.isHiddenFromSidebar) continue;

      const activityAt = bot.lastActivityAt ?? bot.updatedAt ?? 0;
      const existing = this.watches.get(bot.id);
      if (!existing && activityAt < nowMs - this.discoveryWindowMs) continue;

      const replicaFile = [...sliceFiles.entries()].find(([key]) => key.endsWith(`transcript.replicas.${bot.id}`));
      let entries: GrokBotTranscriptEntry[] = [];
      let mtimeMs = 0;
      if (replicaFile) {
        try {
          mtimeMs = fs.statSync(replicaFile[1]).mtimeMs;
          entries = parseTranscriptReplica(JSON.parse(fs.readFileSync(replicaFile[1], 'utf8')));
        } catch {
          entries = [];
        }
      }

      const derived = deriveGrokBotSession({
        bot,
        entries,
        fileMtimeMs: mtimeMs,
        nowMs,
        activityStreamMs: this.activityStreamMs,
      });

      const eventKey = `${derived.state}|${derived.promptSnippet || ''}|${derived.outputSnippet || ''}`;
      const shouldEmit = !existing || eventKey !== existing.eventKey || mtimeMs > existing.mtimeMs;
      this.watches.set(bot.id, { eventKey, mtimeMs });
      if (!shouldEmit) continue;

      const event: AgentEvent = {
        eventId: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        sessionId: `grokbot_${bot.id}`,
        agentType: 'grokbot',
        state: derived.state,
        project: bot.name.slice(0, 80),
        displayPath: '~',
        promptSnippet: derived.promptSnippet,
        outputSnippet: derived.outputSnippet,
        timestamp: new Date(nowMs).toISOString(),
      };
      this.registry.recordEvent(event);
    }
  }

  private listSliceFiles(): Map<string, string> {
    const slices = new Map<string, string>();
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(this.persistDir, { withFileTypes: true });
    } catch {
      return slices;
    }
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.blob')) continue;
      const key = decodeSliceKey(entry.name);
      if (key) slices.set(key, path.join(this.persistDir, entry.name));
    }
    return slices;
  }
}
