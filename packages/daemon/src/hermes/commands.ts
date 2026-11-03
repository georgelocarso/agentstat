import { execFile as execFileCallback } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);

const COMMAND_TIMEOUT_MS = 8_000;
const COMMAND_MAX_BUFFER = 16 * 1024 * 1024;

export const LOG_TAIL_LINES = 200;
export const ACTIVITY_LOG_LINES = 80;
export const ACTIVITY_WINDOW = '3m';
export const SESSION_LIMIT = 3;

/**
 * Fixed, compile-time allowlist of read-only probes. This is the only place a
 * `hermes` invocation is described: every argv below starts with a literal and
 * only ever interpolates a validated profile/board value. Nothing here can
 * submit work to Hermes — the monitor only reads.
 */
export const HERMES_ALLOWLIST = [
  ['profile', 'list'],
  ['-p', ':profile', 'logs', 'agent', '-n', String(ACTIVITY_LOG_LINES), '--since', ACTIVITY_WINDOW],
  ['-p', ':profile', 'sessions', 'list', '--limit', String(SESSION_LIMIT)],
  ['logs', 'agent', '-n', String(LOG_TAIL_LINES)],
  ['logs', 'gateway', '-n', String(LOG_TAIL_LINES)],
  ['logs', 'errors', '-n', String(LOG_TAIL_LINES)],
  ['status', '--all'],
] as const;

export type HermesErrorCode = 'COMMAND_FAILED' | 'TIMEOUT' | 'NOT_INSTALLED';

/** Error thrown by the Hermes runner. Carries stdout so callers can spot benign states. */
export class HermesCommandError extends Error {
  constructor(message: string, readonly code: HermesErrorCode, readonly stdout = '') {
    super(message);
  }
}

/** Env the child gets on every OS: forced plain, piped-friendly output. */
export function hermesEnv(): NodeJS.ProcessEnv {
  return { ...process.env, NO_COLOR: '1', TERM: 'dumb', COLUMNS: '200', PYTHONIOENCODING: 'utf-8' };
}

/**
 * Resolve the Hermes binary once. `execFile('hermes')` works for a `.exe`/ELF
 * on PATH, but not for a `.cmd` wrapper (Windows), so probe PATH explicitly.
 * Read-only: checks for existence of a handful of well-known artifact names.
 */
export function resolveHermesBinary(candidates?: string[]): string | undefined {
  const names = candidates ?? (process.platform === 'win32' ? ['hermes.exe', 'hermes.cmd', 'hermes.bat', 'hermes'] : ['hermes']);
  const ext = process.platform === 'win32' ? ';' : ':';
  const dirs = (process.env.PATH ?? '').split(ext).filter(Boolean);
  for (const dir of dirs) {
    for (const name of names) {
      const full = path.join(dir, name);
      if (existsSync(full)) return full;
    }
  }
  return undefined;
}

type ExecFile = (file: string, args: string[], options: object) => Promise<{ stdout: string }>;

export type HermesRunner = (args: string[]) => Promise<string>;

/** Error handler matching the shared failure taxonomy. */
function describeFailure(error: unknown): HermesCommandError {
  const detail = (error ?? {}) as { code?: unknown; killed?: boolean; signal?: unknown; stdout?: unknown; message?: unknown };
  const stdout = typeof detail.stdout === 'string' ? detail.stdout : '';
  if (detail.code === 'ENOENT') return new HermesCommandError('hermes is not installed or not on PATH.', 'NOT_INSTALLED', stdout);
  if (detail.killed || detail.signal === 'SIGTERM' || /timed? ?out/i.test(String(detail.message ?? ''))) {
    return new HermesCommandError('Hermes read timed out.', 'TIMEOUT', stdout);
  }
  if (detail.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
    return new HermesCommandError('Hermes output exceeded the read limit.', 'COMMAND_FAILED', stdout);
  }
  if (typeof detail.code === 'number') return new HermesCommandError(`hermes exited with code ${detail.code}.`, 'COMMAND_FAILED', stdout);
  return new HermesCommandError('hermes could not be read.', 'COMMAND_FAILED', stdout);
}

/** Default runner: execFile with the piped environment, strict timeout, big buffer. */
export function defaultHermesRunner(binary: string): HermesRunner {
  return async (args: string[]): Promise<string> => {
    try {
      const { stdout } = await (execFile as unknown as ExecFile)(binary, args, {
        timeout: COMMAND_TIMEOUT_MS,
        maxBuffer: COMMAND_MAX_BUFFER,
        env: hermesEnv(),
        windowsHide: true,
      });
      return stdout;
    } catch (error) {
      throw describeFailure(error);
    }
  };
}

/**
 * Missing log files are an expected empty state, not a failure: Hermes only
 * creates `agent.log` etc. once the profile has done real work.
 */
export const LOG_MISSING = /Log file not found/i;

/**
 * TTL cache with shared in-flight reads: concurrent callers for the same key
 * collapse into one invocation, and a fresh-enough result short-circuits.
 */
export class ProbeCache {
  private entries = new Map<string, { promise: Promise<string>; expiresAt: number }>();

  get(key: string, ttlMs: number, compute: () => Promise<string>): Promise<string> {
    const now = Date.now();
    const cached = this.entries.get(key);
    if (cached && now < cached.expiresAt) return cached.promise;
    let promise: Promise<string>;
    try {
      promise = compute();
    } catch (error) {
      this.entries.delete(key);
      return Promise.reject(error);
    }
    promise = promise.catch((error) => {
      this.entries.delete(key);
      throw error;
    });
    this.entries.set(key, { promise, expiresAt: now + ttlMs });
    return promise;
  }

  clear(): void {
    this.entries.clear();
  }
}

/** Runs `task` over `items` with at most `limit` in flight, keeping input order. A task failure rejects the whole batch. */
export async function mapLimit<T, R>(items: readonly T[], limit: number, task: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  let closed = false;
  const worker = async () => {
    while (!closed) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await task(items[index], index);
    }
  };
  try {
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  } catch (error) {
    closed = true;
    throw error;
  }
  return results;
}
