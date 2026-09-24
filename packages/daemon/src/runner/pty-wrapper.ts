import crypto from 'node:crypto';
import type { AgentEvent, SessionState } from '@agentstat/shared';
import { sanitizePath, scrubSecrets } from '@agentstat/shared';
import { detectState } from './detector.js';
import { getGitBranch, getProjectName } from '../git.js';

export interface RunnerOptions {
  command: string;
  args: string[];
  cwd?: string;
  daemonUrl?: string;
  token?: string;
}

export class PtyWrapper {
  private sessionId: string;
  private cwd: string;
  private daemonUrl: string;
  private token?: string;
  private project: string;
  private gitBranch?: string;
  private currentState: SessionState = 'working';
  private buffer = '';

  constructor(options: RunnerOptions) {
    this.sessionId = 'agy_sess_' + crypto.randomBytes(4).toString('hex');
    this.cwd = options.cwd || process.cwd();
    this.daemonUrl = options.daemonUrl || 'http://127.0.0.1:4111';
    this.token = options.token;
    this.project = getProjectName(this.cwd);
    this.gitBranch = getGitBranch(this.cwd);
  }

  public async start(command: string, args: string[]): Promise<number> {
    // Notify daemon that session started
    await this.emitEvent('working');

    let ptyProcess: any = null;

    try {
      // Dynamic import node-pty
      const pty = await import('node-pty');
      const isWindows = process.platform === 'win32';
      const shell = isWindows ? (process.env.COMSPEC || 'cmd.exe') : (process.env.SHELL || '/bin/bash');
      
      const ptyArgs = isWindows 
        ? ['/c', command, ...args] 
        : ['-c', [command, ...args].join(' ')];

      ptyProcess = pty.spawn(shell, ptyArgs, {
        name: 'xterm-256color',
        cols: process.stdout.columns || 80,
        rows: process.stdout.rows || 24,
        cwd: this.cwd,
        env: process.env as Record<string, string>,
      });
    } catch (err) {
      // Fallback to standard child_process if native pty binding isn't available
      return this.startFallback(command, args);
    }

    if (process.stdin.isTTY && process.stdin.setRawMode) {
      process.stdin.setRawMode(true);
    }
    process.stdin.resume();

    // Resize handler
    const onResize = () => {
      if (ptyProcess && process.stdout.columns && process.stdout.rows) {
        ptyProcess.resize(process.stdout.columns, process.stdout.rows);
      }
    };
    process.stdout.on('resize', onResize);

    // Forward stdin to PTY
    process.stdin.on('data', (chunk) => {
      ptyProcess.write(chunk.toString());
    });

    return new Promise<number>((resolve) => {
      ptyProcess.onData((data: string) => {
        // Direct transparent passthrough to user's terminal
        process.stdout.write(data);

        // Analyze output for prompt triggers
        const { state, promptSnippet } = detectState(data, this.buffer);
        this.buffer = (this.buffer + data).slice(-2000);

        if (state !== this.currentState || (state === 'waiting_approval' && promptSnippet)) {
          this.currentState = state;
          this.emitEvent(state, promptSnippet);
        }
      });

      ptyProcess.onExit(async ({ exitCode }: { exitCode: number }) => {
        if (process.stdin.isTTY && process.stdin.setRawMode) {
          process.stdin.setRawMode(false);
        }
        process.stdin.pause();
        process.stdout.off('resize', onResize);

        const finalState: SessionState = exitCode === 0 ? 'completed' : 'crashed';
        await this.emitEvent(finalState, undefined, exitCode);
        resolve(exitCode);
      });
    });
  }

  private async startFallback(command: string, args: string[]): Promise<number> {
    const { spawn } = await import('node:child_process');
    const child = spawn(command, args, {
      cwd: this.cwd,
      stdio: ['inherit', 'pipe', 'pipe'],
      shell: true,
      env: process.env,
    });

    child.stdout?.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      process.stdout.write(text);
      const { state, promptSnippet } = detectState(text, this.buffer);
      this.buffer = (this.buffer + text).slice(-2000);
      if (state !== this.currentState) {
        this.currentState = state;
        this.emitEvent(state, promptSnippet);
      }
    });

    child.stderr?.on('data', (chunk: Buffer) => {
      process.stderr.write(chunk);
    });

    return new Promise<number>((resolve) => {
      child.on('close', async (code) => {
        const exitCode = code ?? 0;
        const finalState: SessionState = exitCode === 0 ? 'completed' : 'crashed';
        await this.emitEvent(finalState, undefined, exitCode);
        resolve(exitCode);
      });
    });
  }

  private async emitEvent(state: SessionState, promptSnippet?: string, exitCode?: number) {
    const event: AgentEvent = {
      eventId: 'evt_' + crypto.randomBytes(6).toString('hex'),
      sessionId: this.sessionId,
      agentType: 'agy',
      state,
      project: this.project,
      displayPath: sanitizePath(this.cwd),
      gitBranch: this.gitBranch,
      promptSnippet: promptSnippet ? scrubSecrets(promptSnippet) : undefined,
      exitCode,
      pid: process.pid,
      timestamp: new Date().toISOString(),
    };

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (this.token) {
        headers['Authorization'] = `Bearer ${this.token}`;
      }

      await fetch(`${this.daemonUrl}/api/events`, {
        method: 'POST',
        headers,
        body: JSON.stringify(event),
      });
    } catch {
      // Daemon might not be running or reachable, do not crash the agent process
    }
  }
}
