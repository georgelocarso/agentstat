import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import readline from 'node:readline';
import type { AgentEvent, SessionState } from '@agentstat/shared';
import { sanitizePath, scrubSecrets } from '@agentstat/shared';
import { SessionRegistry } from '../registry.js';

interface WatcherOptions {
  brainDir?: string;
  pollIntervalMs?: number;
}

export class TranscriptWatcher {
  private brainDir: string;
  private pollIntervalMs: number;
  private registry: SessionRegistry;
  private activeWatches = new Map<string, { offset: number; lastMtime: number; projectName: string; displayPath: string }>();
  private timer?: NodeJS.Timeout;

  constructor(registry: SessionRegistry, options: WatcherOptions = {}) {
    this.registry = registry;
    this.pollIntervalMs = options.pollIntervalMs || 2000;
    
    // Default Antigravity CLI brain directory: ~/.gemini/antigravity-cli/brain
    const home = os.homedir();
    this.brainDir = options.brainDir || path.join(home, '.gemini', 'antigravity-cli', 'brain');
  }

  public start(): void {
    if (!fs.existsSync(this.brainDir)) {
      console.log(`[watcher] Brain directory not found at ${this.brainDir}. Watching will retry periodically.`);
    }

    this.scanSessions();
    this.timer = setInterval(() => this.scanSessions(), this.pollIntervalMs);
    if (this.timer.unref) {
      this.timer.unref();
    }
    console.log(`[watcher] Automatic agy session discovery active (watching ${this.brainDir})`);
  }

  public stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
    }
  }

  /**
   * Scans brain directory for session folders and updates active transcripts
   */
  public scanSessions(): void {
    if (!fs.existsSync(this.brainDir)) return;

    try {
      const entries = fs.readdirSync(this.brainDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const sessionId = entry.name;
        const sessionDir = path.join(this.brainDir, sessionId);
        const transcriptPath = path.join(sessionDir, '.system_generated', 'logs', 'transcript.jsonl');

        if (fs.existsSync(transcriptPath)) {
          this.processTranscript(sessionId, transcriptPath);
        }
      }
    } catch (err) {
      // Ignore transient access errors
    }
  }

  private processTranscript(sessionId: string, filePath: string): void {
    try {
      const stats = fs.statSync(filePath);
      const watchInfo = this.activeWatches.get(sessionId) || {
        offset: 0,
        lastMtime: 0,
        projectName: 'agy-session',
        displayPath: '~',
      };

      // Only read if modified or first discovery
      if (stats.mtimeMs <= watchInfo.lastMtime && watchInfo.offset === stats.size) {
        return;
      }

      // If file was truncated/recreated, reset offset
      if (stats.size < watchInfo.offset) {
        watchInfo.offset = 0;
      }

      const stream = fs.createReadStream(filePath, {
        start: watchInfo.offset,
        encoding: 'utf-8',
      });

      const rl = readline.createInterface({
        input: stream,
        crlfDelay: Infinity,
      });

      let latestEvent: Partial<AgentEvent> | null = null;
      let lastCwd = watchInfo.displayPath;
      let lastProject = watchInfo.projectName;

      rl.on('line', (line) => {
        if (!line.trim()) return;
        try {
          const entry = JSON.parse(line);
          const parsed = this.parseTranscriptEntry(sessionId, entry);
          if (parsed) {
            latestEvent = parsed;
            if (parsed.displayPath) lastCwd = parsed.displayPath;
            if (parsed.project) lastProject = parsed.project;
          }
        } catch {
          // ignore corrupted or incomplete lines
        }
      });

      rl.on('close', () => {
        watchInfo.offset = stats.size;
        watchInfo.lastMtime = stats.mtimeMs;
        watchInfo.projectName = lastProject;
        watchInfo.displayPath = lastCwd;
        this.activeWatches.set(sessionId, watchInfo);

        if (latestEvent) {
          const fullEvent: AgentEvent = {
            eventId: `evt_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
            sessionId,
            agentType: 'agy',
            state: latestEvent.state || 'working',
            project: lastProject,
            displayPath: lastCwd,
            promptSnippet: latestEvent.promptSnippet,
            outputSnippet: latestEvent.outputSnippet,
            timestamp: latestEvent.timestamp || new Date(stats.mtimeMs).toISOString(),
          };

          this.registry.recordEvent(fullEvent);
        }
      });
    } catch {
      // Ignore read errors
    }
  }

  /**
   * Translates transcript entry into an AgentEvent
   */
  private parseTranscriptEntry(sessionId: string, entry: any): Partial<AgentEvent> | null {
    const timestamp = entry.created_at || new Date().toISOString();
    const type = entry.type;
    const source = entry.source;
    const status = entry.status;

    let state: SessionState = 'working';
    let promptSnippet: string | undefined;
    let outputSnippet: string | undefined;
    let project = 'agy-session';
    let displayPath = '~';

    // Extract project from workspace mapping if found in content
    if (entry.content && typeof entry.content === 'string') {
      const wsMatch = entry.content.match(/(?:[A-Za-z]:)?(?:\/|\\)[^\r\n"']+->\s*(?:[A-Za-z]:)?(?:\/|\\)[^\r\n"']+/);
      if (wsMatch) {
        const rawDir = wsMatch[0].split('->')[0].trim();
        displayPath = sanitizePath(rawDir);
        project = path.basename(rawDir.replace(/\\/g, '/')) || 'agy-session';
      }
    }

    // Extract workspace Cwd from tool calls if present
    if (entry.tool_calls && Array.isArray(entry.tool_calls)) {
      for (const call of entry.tool_calls) {
        if (call.args && call.args.Cwd) {
          let cwdStr = String(call.args.Cwd).replace(/^"(.*)"$/, '$1');
          displayPath = sanitizePath(cwdStr);
          project = path.basename(cwdStr.replace(/\\/g, '/')) || 'agy-session';
        }

        // If tool call is ask_question, it is waiting for user approval / selection
        if (call.name === 'ask_question') {
          state = 'waiting_approval';
          const q = call.args?.questions?.[0]?.question || 'Interactive question / choice';
          promptSnippet = scrubSecrets(q);
        }
      }
    }

    // Check user request (agent starts working on user input)
    if (source === 'USER_EXPLICIT' && type === 'USER_INPUT') {
      state = 'working';
      const cleanContent = (entry.content || '')
        .replace(/<ADDITIONAL_METADATA>[\s\S]*?<\/ADDITIONAL_METADATA>/gi, '')
        .replace(/<USER_SETTINGS_CHANGE>[\s\S]*?<\/USER_SETTINGS_CHANGE>/gi, '')
        .replace(/<[^>]+>/g, '')
        .trim();
      if (cleanContent) {
        promptSnippet = scrubSecrets(cleanContent.slice(0, 180));
      }
    }

    // Check model response (when model finishes turn without tool calls, session is idle / awaiting user)
    if (source === 'MODEL' && type === 'PLANNER_RESPONSE') {
      const hasPendingTools = entry.tool_calls && Array.isArray(entry.tool_calls) && entry.tool_calls.length > 0;
      if (!hasPendingTools && entry.content && typeof entry.content === 'string') {
        state = 'idle';
        const cleanOutput = entry.content.replace(/<[^>]+>/g, '').trim();
        if (cleanOutput) {
          outputSnippet = scrubSecrets(cleanOutput.slice(0, 240));
        }
      } else if (hasPendingTools) {
        state = 'working';
      }
    }

    // Check if waiting for feedback / user approval
    if (entry.content && typeof entry.content === 'string') {
      const content = entry.content;
      if (
        content.includes('waiting_for_input') ||
        content.includes('Allow agy to run:') ||
        content.includes('Approve?') ||
        content.includes('Execute command?')
      ) {
        state = 'waiting_approval';
        promptSnippet = scrubSecrets(content.slice(0, 140));
      }
    }

    return {
      state,
      promptSnippet,
      outputSnippet,
      project,
      displayPath,
      timestamp,
    };
  }
}
