import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import readline from 'node:readline';
import type { AgentEvent, SessionState } from '@agentstat/shared';
import { SessionRegistry } from '../registry.js';
import { parseCodexRecord } from '../codex/events.js';

interface WatchInfo { offset: number; lastMtime: number; sessionId: string; project: string; displayPath: string; state: SessionState; }

export class CodexRolloutWatcher {
  private root: string;
  private pollIntervalMs: number;
  private registry: SessionRegistry;
  private watches = new Map<string, WatchInfo>();
  private timer?: NodeJS.Timeout;

  constructor(registry: SessionRegistry, options: { codexHome?: string; pollIntervalMs?: number } = {}) {
    this.registry = registry;
    this.root = path.join(options.codexHome || process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'sessions');
    this.pollIntervalMs = options.pollIntervalMs || 2000;
  }

  start(): void {
    this.scanSessions();
    this.timer = setInterval(() => this.scanSessions(), this.pollIntervalMs);
    this.timer.unref?.();
    console.log(`[watcher] Automatic Codex session discovery active (watching ${this.root})`);
  }

  stop(): void { if (this.timer) clearInterval(this.timer); }

  scanSessions(): void {
    if (!fs.existsSync(this.root)) return;
    const files: string[] = [];
    const walk = (dir: string) => {
      let entries: fs.Dirent[];
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.isFile() && /^rollout-.*\.jsonl$/i.test(entry.name)) files.push(full);
      }
    };
    walk(this.root);
    for (const file of files) this.processFile(file);
  }

  private processFile(filePath: string): void {
    let stats: fs.Stats;
    try { stats = fs.statSync(filePath); } catch { return; }
    const key = filePath;
    const idFromName = path.basename(filePath).replace(/^rollout-/, '').replace(/\.jsonl$/, '');
    const info = this.watches.get(key) || { offset: 0, lastMtime: 0, sessionId: `codex_${idFromName}`, project: 'codex-session', displayPath: '~', state: 'working' as SessionState };
    if (stats.size < info.offset) info.offset = 0;
    if (stats.size === info.offset && stats.mtimeMs <= info.lastMtime) return;
    const stream = fs.createReadStream(filePath, { start: info.offset, encoding: 'utf8' });
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
    const events: Partial<AgentEvent>[] = [];
    rl.on('line', line => {
      if (!line.trim()) return;
      try {
        const record = JSON.parse(line);
        const payload = record.payload || record;
        if (payload?.type === 'session_meta' || record.type === 'session_meta') {
          const meta = payload;
          if (meta.id) info.sessionId = `codex_${meta.id}`;
          if (meta.cwd) info.displayPath = meta.cwd;
          if (meta.cwd) info.project = path.basename(String(meta.cwd).replace(/\\/g, '/')) || info.project;
        }
        const parsed = parseCodexRecord(record, { sessionId: info.sessionId, project: info.project, displayPath: info.displayPath, state: info.state });
        if (parsed) { events.push(parsed); info.state = parsed.state || info.state; info.project = parsed.project || info.project; info.displayPath = parsed.displayPath || info.displayPath; }
      } catch { /* ignore partial/corrupt lines */ }
    });
    rl.on('close', () => {
      info.offset = stats.size; info.lastMtime = stats.mtimeMs; this.watches.set(key, info);
      for (const event of events) this.registry.recordEvent({ eventId: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, sessionId: info.sessionId, agentType: 'codex', state: event.state || info.state, project: event.project || info.project, displayPath: event.displayPath || info.displayPath, promptSnippet: event.promptSnippet, outputSnippet: event.outputSnippet, timestamp: event.timestamp || new Date(stats.mtimeMs).toISOString() });
    });
  }
}
