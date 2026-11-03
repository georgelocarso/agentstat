import type { GatewayState } from './types.js';

/**
 * Parsers for the Hermes CLI output as printed to a pipe (ANSI stripped by the
 * runner). Formats follow the installed `hermes` build; each parser is covered
 * by fixture tests captured from real output (see hermes-watcher.test.ts).
 */

export type { GatewayState };

export interface HermesProfile {
  name: string;
  model: string;
  gateway: GatewayState;
}

export interface HermesLogRecord {
  timestamp: string;
  logger: string;
  message: string;
}

export type ActivityKind = 'cron' | 'chat' | 'tools' | 'thinking';

export interface HermesSession {
  title: string;
  workspace?: string;
  lastActive: string;
  id?: string;
}

// ---------------------------------------------------------------------------
// Shared text helpers

export function stripAnsi(output: string): string {
  return output.replace(new RegExp(`${String.fromCharCode(27)}\\[[0-?]*[ -/]*[@-~]`, 'g'), '');
}

export function lines(output: string): string[] {
  return stripAnsi(output).replace(/\r/g, '').split('\n');
}

function nonEmpty(value: string | undefined): string | undefined {
  return value && value.trim() ? value.trim() : undefined;
}

// ---------------------------------------------------------------------------
// Profile list

/** `hermes profile list` rows: name, model, gateway state; later columns ignored. */
export const PROFILE_ROW = /^(.+?)\s+(\S+)\s+(running|stopped)(?:\s|$)/i;

/** Profile names passed to `hermes -p`: plain names only, never an option. */
export const PROFILE_NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;

/**
 * Decoration glyphs some builds prefix to the name (e.g. `◆default`).
 * Anything that is not a word character is stripped from the start.
 */
const DECORATION = /^[^A-Za-z0-9]+/;

export function parseProfiles(output: string): HermesProfile[] {
  const profiles: HermesProfile[] = [];
  const seen = new Set<string>();
  for (const line of lines(output)) {
    const row = line.match(PROFILE_ROW);
    if (!row) continue; // header, box-drawing rule, or `… more not shown` lines
    const name = (nonEmpty(row[1])?.replace(DECORATION, '')) ?? '';
    if (!name || !PROFILE_NAME.test(name) || seen.has(name)) continue;
    const model = nonEmpty(row[2]);
    if (!model) continue;
    seen.add(name);
    profiles.push({ name, model, gateway: row[3].toLowerCase() as GatewayState });
  }
  return profiles;
}

// ---------------------------------------------------------------------------
// Agent logs

/** Log record: `2026-11-03 22:42:44,803 INFO plugins.platforms.x.cron-run: message`. */
export const LOG_RECORD = /^(\d{4}-\d{2}-\d{2}[ T][\d:,.]+)\s+[A-Z]+(?:\s+\[[^\]]*\])?\s+([\w.-]+):\s?(.*)$/;

// `hermes logs agent -n N` prints a `--- …/logs/agent.log (last N) ---` banner
const LOG_FILE_BANNER = /^---\s+.*\s\(last\s+\d+\)\s+---$/;

export function parseLogRecords(output: string): HermesLogRecord[] {
  const records: HermesLogRecord[] = [];
  for (const line of lines(output)) {
    if (LOG_FILE_BANNER.test(line.trim())) continue;
    const record = line.match(LOG_RECORD);
    if (!record) continue;
    records.push({ timestamp: record[1], logger: record[2], message: record[3] });
  }
  return records;
}

const CHAT_MESSAGE = /\b(message|reply|replied|respond|inbound|outbound|received|sending|sent|chat)\b/i;

/**
 * Logger name → activity kind. Gateway/platform lines are polling noise by
 * themselves: they only mean "chat" when combined with agent-loop lines.
 */
export function loggerKind(logger: string, message: string): ActivityKind | 'gateway' | undefined {
  if (/^cron\b/.test(logger)) return 'cron';
  if (/^(tools|model_tools)\b/.test(logger)) return 'tools';
  if (/^(agent|run_agent|batch_runner)\b/.test(logger)) return 'thinking';
  if (/^(gateway|hermes_plugins|plugins\.platforms)\b/.test(logger)) {
    return CHAT_MESSAGE.test(message) ? 'chat' : 'gateway';
  }
  return undefined; // hermes_cli, uvicorn, gui: not agent work
}

export const ACTIVITY_LABELS: Record<ActivityKind, string> = {
  cron: 'Running scheduled job',
  chat: 'Replying to a chat',
  tools: 'Using tools',
  thinking: 'Working on a request',
};

/** Kind preference order: the most specific evidence wins. */
const KIND_ORDER: readonly ActivityKind[] = ['cron', 'chat', 'tools', 'thinking'];

export interface HermesActivity {
  active: boolean;
  kind?: ActivityKind;
  label?: string;
  lastSeen?: string;
  /** Raw text of the log line that decided the activity, already un-redacted input. */
  message?: string;
}

/**
 * Classify recent activity from a log window. A session listing (optional) can
 * also prove activity: a session last active "just now / 0-3m ago" counts as
 * chat work when the logs show no agent work at all.
 */
export function classifyActivity(logOutput: string, sessionOutput?: string): HermesActivity {
  const found = new Set<ActivityKind | 'gateway'>();
  const lastMessages = new Map<ActivityKind, string>();
  let lastSeen: string | undefined;
  for (const record of parseLogRecords(logOutput)) {
    const kind = loggerKind(record.logger, record.message);
    if (!kind) continue;
    found.add(kind);
    if (kind !== 'gateway') {
      lastSeen = record.timestamp;
      lastMessages.set(kind, record.message);
    }
  }
  // Gateway lines alone are polling noise; combined with agent-loop lines they are a chat reply.
  if (found.has('gateway') && (found.has('thinking') || found.has('tools'))) found.add('chat');

  let sessionActive = false;
  if (sessionOutput !== undefined) {
    try {
      const sessions = parseSessions(sessionOutput);
      sessionActive = sessions.length > 0 && isSessionFresh(sessions[0].lastActive);
    } catch {
      sessionActive = false;
    }
  }
  if (sessionActive && found.size === 0) found.add('chat');

  const kind = KIND_ORDER.find((item) => found.has(item));
  return {
    active: kind !== undefined,
    ...(kind ? { kind, label: ACTIVITY_LABELS[kind] } : {}),
    ...(kind && lastMessages.has(kind) ? { message: lastMessages.get(kind) } : {}),
    ...(lastSeen ? { lastSeen } : {}),
  };
}

// ---------------------------------------------------------------------------
// Sessions

const SESSION_ROW = /^(.+?)\s{2,}(\S+)\s{2,}(.+?)\s{2,}(\S+)\s*$/;
const MORE_NOT_SHOWN = /more not shown/i;
const SESSIONS_HEADER = /^Title\s+Workspace\s+Last Active\s+ID$/;
/** Placeholder rows whose columns are all dashes/box glyphs carry no session. */
const PUNCTUATION_PLACEHOLDER = /^[^A-Za-z0-9_]+$/;

export function parseSessions(output: string): HermesSession[] {
  const sessions: HermesSession[] = [];
  for (const line of lines(output)) {
    const trimmed = line.trim();
    if (!trimmed || MORE_NOT_SHOWN.test(trimmed) || SESSIONS_HEADER.test(trimmed)) continue;
    const row = trimmed.match(SESSION_ROW);
    if (!row) continue;
    const title = nonEmpty(row[1]);
    const lastActive = nonEmpty(row[3]);
    if (!title || !lastActive) continue;
    if (PUNCTUATION_PLACEHOLDER.test(title)) continue; // `—   —   —   —` style filler row
    sessions.push({ title, workspace: nonEmpty(row[2]), lastActive, id: nonEmpty(row[4]) });
  }
  return sessions;
}

/** Human "last active" freshness within the 3-minute activity window. */
export function isSessionFresh(lastActive: string): boolean {
  return /^just now$|^[0-3]m ago$/.test(lastActive.trim());
}
