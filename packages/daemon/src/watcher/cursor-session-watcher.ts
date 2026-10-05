import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import readline from 'node:readline';
import type { AgentEvent, SessionState } from '@agentstat/shared';
import { sanitizePath, scrubSecrets } from '@agentstat/shared';
import { SessionRegistry } from '../registry.js';
import {
  cursorStateFromMessages,
  parseCursorChatMetaFile,
  parseCursorTranscriptRecord,
} from '../cursor/events.js';
import { readCursorStoreSnapshot, type CursorStoreSnapshot } from '../cursor/store-db.js';

interface TranscriptWatch {
  offset: number;
  lastMtime: number;
  sessionId: string;
  project: string;
  displayPath: string;
  state: SessionState;
  eventKey: string;
}

interface ChatWatch {
  lastMtimeMs: number;
  project: string;
  displayPath: string;
  eventKey: string;
}

export interface CursorWatcherOptions {
  cursorHome?: string;
  pollIntervalMs?: number;
  /**
   * Only sessions touched within this window are imported on first discovery; Cursor keeps
   * hundreds of historical transcripts and the HUD is a live monitor, not a history browser.
   * Sessions already being watched are always tracked to completion.
   */
  discoveryWindowMs?: number;
  /** Test seam for store.db reads; defaults to the real node:sqlite reader. */
  storeReader?: (dbPath: string) => Promise<CursorStoreSnapshot | null>;
}

const DEFAULT_DISCOVERY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Discovers Cursor sessions without wrapping the CLI:
 *
 * - Agent transcripts (`~/.cursor/projects/<slug>/agent-transcripts/<id>/<id>.jsonl`) are tailed
 *   append-only for live prompt/output/state updates.
 * - CLI chat stores (`~/.cursor/chats/<hash>/<id>/`) are polled via `meta.json` + `store.db`;
 *   store.db message blobs are best-effort (Cursor encrypts some payloads).
 */
export class CursorSessionWatcher {
  private root: string;
  private projectsDir: string;
  private chatsDir: string;
  private pollIntervalMs: number;
  private discoveryWindowMs: number;
  private registry: SessionRegistry;
  private transcriptWatches = new Map<string, TranscriptWatch>();
  private chatWatches = new Map<string, ChatWatch>();
  private timer?: NodeJS.Timeout;
  private readonly storeReader: (dbPath: string) => Promise<CursorStoreSnapshot | null>;

  constructor(registry: SessionRegistry, options: CursorWatcherOptions = {}) {
    this.registry = registry;
    this.root = options.cursorHome || process.env.CURSOR_HOME || path.join(os.homedir(), '.cursor');
    this.projectsDir = path.join(this.root, 'projects');
    this.chatsDir = path.join(this.root, 'chats');
    this.pollIntervalMs = options.pollIntervalMs || 2000;
    this.discoveryWindowMs = options.discoveryWindowMs ?? DEFAULT_DISCOVERY_WINDOW_MS;
    this.storeReader = options.storeReader || ((dbPath) => readCursorStoreSnapshot(dbPath));
  }

  public start(): void {
    void this.scan();
    this.timer = setInterval(() => void this.scan(), this.pollIntervalMs);
    this.timer.unref?.();
    console.log(`[watcher] Automatic Cursor session discovery active (watching ${this.projectsDir} and ${this.chatsDir})`);
  }

  public stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  public async scan(): Promise<void> {
    await this.scanTranscripts();
    await this.scanChats();
  }

  private scanTranscripts(): Promise<void> {
    const jobs: Promise<void>[] = [];
    let projectEntries: fs.Dirent[];
    try {
      projectEntries = fs.readdirSync(this.projectsDir, { withFileTypes: true });
    } catch {
      return Promise.resolve();
    }

    for (const projectEntry of projectEntries) {
      if (!projectEntry.isDirectory() || projectEntry.name.startsWith('.')) continue;
      const transcriptsDir = path.join(this.projectsDir, projectEntry.name, 'agent-transcripts');
      let sessionEntries: fs.Dirent[];
      try {
        sessionEntries = fs.readdirSync(transcriptsDir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const sessionEntry of sessionEntries) {
        if (!sessionEntry.isDirectory()) continue;
        const sessionDir = path.join(transcriptsDir, sessionEntry.name);
        const primary = path.join(sessionDir, `${sessionEntry.name}.jsonl`);
        let transcriptPath: string | undefined;
        if (fs.existsSync(primary)) {
          transcriptPath = primary;
        } else {
          let candidates: fs.Dirent[];
          try {
            candidates = fs.readdirSync(sessionDir, { withFileTypes: true });
          } catch {
            candidates = [];
          }
          const file = candidates.find((entry) => entry.isFile() && entry.name.endsWith('.jsonl'));
          if (file) transcriptPath = path.join(sessionDir, file.name);
        }
        if (transcriptPath) {
          jobs.push(this.processTranscript(transcriptPath, projectEntry.name, sessionEntry.name));
        }
      }
    }

    return Promise.all(jobs).then(() => undefined);
  }

  private processTranscript(filePath: string, projectSlug: string, sessionFolder: string): Promise<void> {
    let stats: fs.Stats;
    try {
      stats = fs.statSync(filePath);
    } catch {
      return Promise.resolve();
    }

    const existing = this.transcriptWatches.get(filePath);
    if (!existing && stats.mtimeMs < Date.now() - this.discoveryWindowMs) {
      return Promise.resolve();
    }
    const info: TranscriptWatch = existing || {
      offset: 0,
      lastMtime: 0,
      sessionId: `cursor_${sessionFolder}`,
      project: projectSlug,
      displayPath: sanitizePath(path.join(this.projectsDir, projectSlug)),
      state: 'working' as SessionState,
      eventKey: '',
    };

    if (stats.size < info.offset) info.offset = 0;
    if (stats.size === info.offset && stats.mtimeMs <= info.lastMtime && existing) {
      return Promise.resolve();
    }

    return new Promise<void>((resolve) => {
      const stream = fs.createReadStream(filePath, { start: info.offset, encoding: 'utf8' });
      const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

      let latestState: SessionState | undefined;
      let latestPrompt: string | undefined;
      let latestOutput: string | undefined;

      rl.on('line', (line) => {
        if (!line.trim()) return;
        try {
          const record = JSON.parse(line);
          const parsed = parseCursorTranscriptRecord(record, {
            sessionId: info.sessionId,
            project: info.project,
            displayPath: info.displayPath,
            state: info.state,
          });
          if (!parsed) return;
          if (parsed.state) latestState = parsed.state;
          if (parsed.promptSnippet !== undefined) latestPrompt = parsed.promptSnippet;
          if (parsed.outputSnippet !== undefined) latestOutput = parsed.outputSnippet;
          if (parsed.project) info.project = parsed.project;
          if (parsed.displayPath) info.displayPath = parsed.displayPath;
        } catch {
          // ignore partial or corrupt lines; the next poll retries from this offset only on size growth
        }
      });

      rl.on('close', () => {
        info.offset = stats.size;
        info.lastMtime = stats.mtimeMs;
        if (latestState) info.state = latestState;

        const eventKey = `${info.state}|${latestPrompt || ''}|${latestOutput || ''}`;
        if (eventKey !== info.eventKey) {
          info.eventKey = eventKey;
          const event: AgentEvent = {
            eventId: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
            sessionId: info.sessionId,
            agentType: 'cursor',
            state: info.state,
            project: info.project,
            displayPath: info.displayPath,
            promptSnippet: latestPrompt,
            outputSnippet: latestOutput,
            // Discovery time: the registry treats this as lastSeenAt, and transcript files
            // carry no per-record timestamps. A real mtime would make the sweeper purge
            // recently-touched-but-finished sessions immediately.
            timestamp: new Date().toISOString(),
          };
          this.registry.recordEvent(event);
        }

        this.transcriptWatches.set(filePath, info);
        resolve();
      });
    });
  }

  private async scanChats(): Promise<void> {
    let workspaceEntries: fs.Dirent[];
    try {
      workspaceEntries = fs.readdirSync(this.chatsDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const workspaceEntry of workspaceEntries) {
      if (!workspaceEntry.isDirectory()) continue;
      const workspaceDir = path.join(this.chatsDir, workspaceEntry.name);
      let chatEntries: fs.Dirent[];
      try {
        chatEntries = fs.readdirSync(workspaceDir, { withFileTypes: true });
      } catch {
        continue;
      }

      for (const chatEntry of chatEntries) {
        if (!chatEntry.isDirectory()) continue;
        const chatDir = path.join(workspaceDir, chatEntry.name);
        const metaPath = path.join(chatDir, 'meta.json');
        const dbPath = path.join(chatDir, 'store.db');

        const mtimeMs = this.latestMtimeMs([metaPath, dbPath, `${dbPath}-wal`]);
        if (mtimeMs === 0) continue;

        const existing = this.chatWatches.get(chatDir);
        if (!existing && mtimeMs < Date.now() - this.discoveryWindowMs) continue;
        if (existing && mtimeMs <= existing.lastMtimeMs) continue;

        const snapshot = fs.existsSync(dbPath) ? await this.storeReader(dbPath) : null;
        const chatMeta = this.readChatMeta(metaPath);

        let project = existing?.project || 'cursor-session';
        let displayPath = existing?.displayPath || '~';
        const workspace = snapshot?.messages.find((message) => message.workspace)?.workspace;
        if (workspace) {
          displayPath = sanitizePath(workspace);
          project = path.basename(workspace.replace(/\\/g, '/')) || project;
        }

        const updatedAtMs = Math.max(chatMeta?.updatedAtMs || 0, mtimeMs);
        const state = cursorStateFromMessages(snapshot?.messages || [], updatedAtMs, Date.now());
        const latestUser = snapshot?.messages.find((message) => message.role === 'user');
        const latestAssistant = snapshot?.messages.find((message) => message.role === 'assistant');
        const promptSnippet = latestUser ? scrubSecrets(latestUser.text).slice(0, 180) : undefined;
        const outputSnippet = latestAssistant ? scrubSecrets(latestAssistant.text).slice(0, 240) : undefined;

        const eventKey = `${state}|${promptSnippet || ''}|${outputSnippet || ''}`;
        const info: ChatWatch = {
          lastMtimeMs: mtimeMs,
          project,
          displayPath,
          eventKey,
        };
        this.chatWatches.set(chatDir, info);

        if (!existing || eventKey !== existing.eventKey) {
          this.registry.recordEvent({
            eventId: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
            sessionId: `cursor_${chatEntry.name}`,
            agentType: 'cursor',
            state,
            project,
            displayPath,
            promptSnippet,
            outputSnippet,
            timestamp: new Date().toISOString(),
          });
        }
      }
    }
  }

  private readChatMeta(metaPath: string) {
    try {
      return parseCursorChatMetaFile(JSON.parse(fs.readFileSync(metaPath, 'utf8')));
    } catch {
      return null;
    }
  }

  private latestMtimeMs(paths: string[]): number {
    let latest = 0;
    for (const candidate of paths) {
      try {
        latest = Math.max(latest, fs.statSync(candidate).mtimeMs);
      } catch {
        // missing file
      }
    }
    return latest;
  }
}
