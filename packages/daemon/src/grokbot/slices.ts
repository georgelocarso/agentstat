import type { SessionState } from '@agentstat/shared';
import { scrubSecrets } from '@agentstat/shared';

/**
 * Grok Bot's cloud sessions are not stored locally as files, but the desktop client keeps
 * encrypted-agnostic "slice" snapshots in `<appData>/Grok Bot/sand-client-persistence/*.blob`:
 *
 * - `sand.client.slice.account.<account>.roster.last-roster` — every Bot with name, description,
 *   last activity, last entry, unread counts and `awaitingUserResponse`.
 * - `sand.client.slice.account.<account>.transcript.replicas.<botId>` — a replica of the chat
 *   transcript: user entries (`kind: "message"`, `role: "user"`) and bot replies
 *   (`kind: "send-message"`, `message.content`).
 *
 * Slice file names are base32-encoded, percent-encoded keys. Values are plain JSON.
 */

const BASE32_ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567';

export interface GrokBotRosterRow {
  id: string;
  name: string;
  description?: string;
  lastActivityAt?: number;
  updatedAt?: number;
  awaitingUserResponse?: unknown;
  lastEntry?: { kind?: string; text?: string };
  isHiddenFromSidebar?: boolean;
}

export interface GrokBotTranscriptEntry {
  kind: string;
  role?: string;
  content?: string;
  isStreaming?: boolean;
  timestampMs?: number;
  seq?: number;
  message?: { type?: string; content?: string };
}

export interface GrokBotSessionDerivation {
  state: SessionState;
  promptSnippet?: string;
  outputSnippet?: string;
}

/** Decodes a `*.blob` file name back into its slice key. */
export function decodeSliceKey(fileName: string): string | null {
  const base = fileName.replace(/\.blob$/i, '');
  if (!base) return null;
  let bits = '';
  for (const char of base.toLowerCase()) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) return null;
    bits += index.toString(2).padStart(5, '0');
  }
  let decoded = '';
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    decoded += String.fromCharCode(parseInt(bits.slice(i, i + 8), 2));
  }
  try {
    return decodeURIComponent(decoded);
  } catch {
    return null;
  }
}

export function parseRoster(raw: unknown): GrokBotRosterRow[] {
  const rows = (raw as any)?.value?.rows;
  if (!Array.isArray(rows)) return [];
  return rows
    .filter((row: any) => row && typeof row.id === 'string' && typeof row.name === 'string')
    .map((row: any) => ({
      id: row.id,
      name: row.name,
      description: typeof row.description === 'string' ? row.description : undefined,
      lastActivityAt: typeof row.lastActivityAt === 'number' ? row.lastActivityAt : undefined,
      updatedAt: typeof row.updatedAt === 'number' ? row.updatedAt : undefined,
      awaitingUserResponse: row.awaitingUserResponse,
      lastEntry:
        row.lastEntry && typeof row.lastEntry === 'object'
          ? { kind: typeof row.lastEntry.kind === 'string' ? row.lastEntry.kind : undefined, text: typeof row.lastEntry.text === 'string' ? row.lastEntry.text : undefined }
          : undefined,
      isHiddenFromSidebar: Boolean(row.isHiddenFromSidebar),
    }));
}

export function parseTranscriptReplica(raw: unknown): GrokBotTranscriptEntry[] {
  const entries = (raw as any)?.value?.entries;
  if (!Array.isArray(entries)) return [];
  return entries.filter((entry: any) => entry && typeof entry.kind === 'string') as GrokBotTranscriptEntry[];
}

function isProgressNoise(content: string): boolean {
  return content.startsWith('data:{') || content.includes('"event":"progress"');
}

function lastUserPrompt(entries: GrokBotTranscriptEntry[]): string | undefined {
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const entry = entries[i];
    if (entry.kind === 'message' && entry.role === 'user' && typeof entry.content === 'string') {
      const content = entry.content.trim();
      if (!content || isProgressNoise(content)) continue;
      return content;
    }
  }
  return undefined;
}

function lastBotOutput(entries: GrokBotTranscriptEntry[]): string | undefined {
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const entry = entries[i];
    const content = typeof entry.message?.content === 'string' ? entry.message.content.trim() : '';
    if (entry.kind === 'send-message' && content) return content;
  }
  return undefined;
}

function awaitingSnippet(awaiting: unknown): string | undefined {
  if (!awaiting) return undefined;
  if (typeof awaiting === 'string') return awaiting;
  if (typeof awaiting === 'object') {
    const record = awaiting as Record<string, unknown>;
    for (const key of ['text', 'message', 'content', 'prompt', 'question']) {
      const value = record[key];
      if (typeof value === 'string' && value.trim()) return value;
    }
    const nested = record.message;
    if (nested && typeof nested === 'object' && typeof (nested as any).content === 'string') {
      return (nested as any).content as string;
    }
  }
  return undefined;
}

/**
 * Derives the observable session state from the roster row plus its transcript replica.
 * Local evidence can only tell whether the last user message was answered; long cloud-side
 * runs after a reply still appear as idle.
 */
export function deriveGrokBotSession(params: {
  bot: GrokBotRosterRow;
  entries: GrokBotTranscriptEntry[];
  fileMtimeMs: number;
  nowMs: number;
  activityStreamMs?: number;
}): GrokBotSessionDerivation {
  const { bot, entries, fileMtimeMs, nowMs } = params;
  const activityStreamMs = params.activityStreamMs ?? 15_000;

  const prompt = lastUserPrompt(entries);
  const output = lastBotOutput(entries);
  const derivation: GrokBotSessionDerivation = {
    state: 'idle',
    promptSnippet: prompt ? scrubSecrets(prompt.replace(/\s+/g, ' ').trim()).slice(0, 180) : undefined,
    outputSnippet: output ? scrubSecrets(output.replace(/\s+/g, ' ').trim()).slice(0, 240) : undefined,
  };

  if (bot.awaitingUserResponse) {
    derivation.state = 'waiting_approval';
    const snippet = awaitingSnippet(bot.awaitingUserResponse);
    if (snippet) {
      derivation.promptSnippet = scrubSecrets(snippet.replace(/\s+/g, ' ').trim()).slice(0, 180);
    }
    return derivation;
  }

  // Progress-noise entries (streamed `data:{...}` frames) trail real messages, so walk
  // backwards to the last meaningful entry before deciding whether the bot replied.
  let lastMeaningful: GrokBotTranscriptEntry | undefined;
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const entry = entries[i];
    if (entry.kind === 'message') {
      if (isProgressNoise(entry.content || '')) continue;
      lastMeaningful = entry;
      break;
    }
    if (entry.kind === 'send-message') {
      lastMeaningful = entry;
      break;
    }
  }

  if (lastMeaningful?.kind === 'message' && lastMeaningful.role === 'user') {
    // The newest user message has no bot reply yet: the bot is working on it.
    derivation.state = 'working';
    return derivation;
  }

  if (nowMs - fileMtimeMs <= activityStreamMs) {
    // The client is actively writing the transcript (streaming reply or new activity).
    derivation.state = 'working';
    return derivation;
  }

  return derivation;
}
