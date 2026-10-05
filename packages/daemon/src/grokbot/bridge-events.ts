import type { SessionState } from '@agentstat/shared';

/**
 * Grok Bot (xAI) runs its agents on a cloud computer, so no chat transcripts exist locally.
 * The only local footprint is the desktop app's local-exec bridge in `~/.grokbot`:
 *
 * - `local-exec-daemon.json` is rewritten with a fresh `servingAt` heartbeat (~every 6s) while
 *   the bridge serves local tool execution; `inflightCount` > 0 while a bot command is running.
 * - `local-exec-daemon.log` appends lifecycle and `[shell-exec]` entries.
 *
 * AgentStat therefore reports a single `grokbot` session per machine: it shows that a Bot is
 * executing locally (working) or that the bridge is idle, without prompt/output content.
 */

export interface GrokBotBridgeDaemon {
  pid?: number;
  startedAt?: number;
  servingAt?: number;
  inflightCount?: number;
}

export interface GrokBotBridgeState {
  state: SessionState;
  outputSnippet?: string;
}

export const GROKBOT_STALE_AFTER_MS = 120_000;

export function parseBridgeDaemon(raw: unknown): GrokBotBridgeDaemon | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;
  const daemon: GrokBotBridgeDaemon = {};
  if (typeof value.pid === 'number') daemon.pid = value.pid;
  if (typeof value.startedAt === 'number') daemon.startedAt = value.startedAt;
  if (typeof value.servingAt === 'number') daemon.servingAt = value.servingAt;
  if (typeof value.inflightCount === 'number') daemon.inflightCount = value.inflightCount;
  if (daemon.servingAt === undefined && daemon.pid === undefined) return null;
  return daemon;
}

/** Last non-empty log line, used as a low-fidelity activity snippet. */
export function pickLogTailLine(logText: string): string | undefined {
  const lines = logText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.length > 0 ? lines[lines.length - 1] : undefined;
}

export function evaluateBridgeState(params: {
  daemon: GrokBotBridgeDaemon | null;
  nowMs: number;
  staleAfterMs?: number;
  logTailLine?: string;
}): GrokBotBridgeState {
  const { daemon, nowMs, logTailLine } = params;
  const staleAfterMs = params.staleAfterMs ?? GROKBOT_STALE_AFTER_MS;

  if (!daemon || daemon.servingAt === undefined) {
    return { state: 'stale', outputSnippet: 'Grok Bot local-exec bridge is not running' };
  }

  const heartbeatAge = nowMs - daemon.servingAt;
  if (heartbeatAge > staleAfterMs) {
    return { state: 'stale', outputSnippet: 'Grok Bot local-exec bridge heartbeat lost' };
  }

  if ((daemon.inflightCount || 0) > 0) {
    const inflight = daemon.inflightCount || 0;
    const detail = logTailLine ? ` — last: ${logTailLine}` : '';
    return { state: 'working', outputSnippet: `Bot executing locally (${inflight} in flight)${detail}`.slice(0, 240) };
  }

  return {
    state: 'idle',
    outputSnippet: logTailLine ? `Bridge idle — last: ${logTailLine}`.slice(0, 240) : 'Local-exec bridge connected; no bot command running',
  };
}
