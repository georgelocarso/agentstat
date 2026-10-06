import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import readline from 'node:readline';
import type { AgentEvent, SessionState } from '@agentstat/shared';
import { SessionRegistry } from '../registry.js';

interface WatchInfo {
  offset: number;
  lastMtime: number;
  sessionId: string;
  project: string;
  displayPath: string;
  state: SessionState;
  gitBranch?: string;
  promptSnippet?: string;
  outputSnippet?: string;
}

/**
 * Watcher for Claude Code CLI sessions located in ~/.claude/projects/
 * Parses <session-uuid>.jsonl transcripts into AgentStatus events.
 */
export class ClaudeSessionWatcher {
  private root: string;
  private pollIntervalMs: number;
  private registry: SessionRegistry;
  private watches = new Map<string, WatchInfo>();
  private timer?: NodeJS.Timeout;

  constructor(registry: SessionRegistry, options: { claudeHome?: string; pollIntervalMs?: number } = {}) {
    this.registry = registry;
    const baseHome = options.claudeHome || process.env.CLAUDE_HOME || path.join(os.homedir(), '.claude');
    this.root = path.join(baseHome, 'projects');
    this.pollIntervalMs = options.pollIntervalMs || 2000;
  }

  start(): void {
    this.scanSessions();
    this.timer = setInterval(() => this.scanSessions(), this.pollIntervalMs);
    this.timer.unref?.();
    console.log(`[watcher] Automatic Claude Code session discovery active (watching ${this.root})`);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
    }
  }

  scanSessions(): void {
    if (!fs.existsSync(this.root)) return;
    const files: string[] = [];

    const walk = (dir: string) => {
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }

      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (entry.isFile() && /^[a-f0-9-]{36}\.jsonl$/i.test(entry.name)) {
          files.push(full);
        }
      }
    };

    walk(this.root);
    for (const file of files) {
      this.processFile(file);
    }
  }

  private processFile(filePath: string): void {
    let stats: fs.Stats;
    try {
      stats = fs.statSync(filePath);
    } catch {
      return;
    }

    const key = filePath;
    const sessionUuid = path.basename(filePath).replace(/\.jsonl$/i, '');
    const parentDir = path.basename(path.dirname(filePath));
    // e.g. C--Data-Project-woex-agentcore -> woex-agentcore
    const inferredProject = parentDir.split('-').pop() || 'claude-project';

    const info: WatchInfo = this.watches.get(key) || {
      offset: 0,
      lastMtime: 0,
      sessionId: `claude_${sessionUuid}`,
      project: inferredProject,
      displayPath: `~/.claude/projects/${parentDir}`,
      state: 'working',
    };

    if (stats.size < info.offset) {
      info.offset = 0; // Rotated/reset
    }

    if (stats.size === info.offset && stats.mtimeMs <= info.lastMtime) {
      return;
    }

    const stream = fs.createReadStream(filePath, { start: info.offset, encoding: 'utf8' });
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

    let latestPrompt: string | undefined;
    let latestOutput: string | undefined;
    let latestState: SessionState = info.state;
    let latestBranch: string | undefined = info.gitBranch;
    let lastTimestamp = new Date(stats.mtimeMs).toISOString();

    rl.on('line', (line) => {
      if (!line.trim()) return;
      try {
        const record = JSON.parse(line);
        if (record.timestamp) {
          lastTimestamp = record.timestamp;
        }
        if (record.gitBranch) {
          latestBranch = record.gitBranch;
        }
        if (record.cwd) {
          info.displayPath = record.cwd;
          info.project = path.basename(record.cwd) || info.project;
        }

        // Process message types
        if (record.type === 'user' && record.message) {
          const content = record.message.content;
          if (typeof content === 'string') {
            if (!content.startsWith('<local-command-caveat>') && !content.startsWith('<command-name>')) {
              latestPrompt = content.trim();
              latestState = 'working';
            }
          } else if (Array.isArray(content)) {
            for (const item of content) {
              if (item.type === 'text' && typeof item.text === 'string') {
                latestPrompt = item.text.trim();
                latestState = 'working';
              }
            }
          }
        } else if (record.type === 'assistant' && record.message) {
          const content = record.message.content;
          if (typeof content === 'string') {
            latestOutput = content.trim();
            latestState = 'working';
          } else if (Array.isArray(content)) {
            for (const item of content) {
              if (item.type === 'text' && typeof item.text === 'string') {
                latestOutput = item.text.trim();
                latestState = 'working';
              } else if (item.type === 'tool_use') {
                latestOutput = `Tool Call: ${item.name || 'tool'}`;
                latestState = 'working';
              }
            }
          }
        } else if (record.type === 'permission-mode') {
          if (record.permissionMode === 'ask') {
            latestState = 'waiting_approval';
          }
        }
      } catch {
        // Skip unparsable line
      }
    });

    rl.on('close', () => {
      info.offset = stats.size;
      info.lastMtime = stats.mtimeMs;
      if (latestBranch) info.gitBranch = latestBranch;
      if (latestPrompt) info.promptSnippet = latestPrompt;
      if (latestOutput) info.outputSnippet = latestOutput;

      // Inactive check: if last modified > 1 hour ago and not waiting approval, mark completed/idle
      const ageMs = Date.now() - stats.mtimeMs;
      if (ageMs > 30 * 60 * 1000 && latestState === 'working') {
        latestState = 'idle';
      }
      info.state = latestState;
      this.watches.set(key, info);

      const event: AgentEvent = {
        eventId: `claude_${sessionUuid}_${stats.mtimeMs}`,
        sessionId: info.sessionId,
        agentType: 'claude',
        state: info.state,
        project: info.project,
        displayPath: info.displayPath,
        gitBranch: info.gitBranch,
        promptSnippet: info.promptSnippet,
        outputSnippet: info.outputSnippet,
        timestamp: lastTimestamp,
      };

      this.registry.recordEvent(event);
    });
  }
}
