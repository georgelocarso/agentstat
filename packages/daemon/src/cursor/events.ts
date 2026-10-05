import path from 'node:path';
import type { AgentEvent, SessionState } from '@agentstat/shared';
import { sanitizePath, scrubSecrets } from '@agentstat/shared';

/**
 * Cursor session sources (verified against Cursor Agent CLI / IDE data):
 *
 * 1. Agent transcripts: `~/.cursor/projects/<project-slug>/agent-transcripts/<session-id>/<session-id>.jsonl`
 *    Append-only JSONL with two record shapes:
 *      { "role": "user" | "assistant", "message": { "content": [{ "type": "text" | "tool_use", ... }] } }
 *      { "type": "turn_ended", "status": "aborted" | "error" | ..., "error"?: "..." }
 *    Subagent transcripts live under `.../subagents/<uuid>.jsonl` and are intentionally ignored
 *    (their activity belongs to the parent session).
 *
 * 2. CLI chat stores: `~/.cursor/chats/<workspace-hash>/<chat-id>/` with `meta.json`
 *    ({ schemaVersion, createdAtMs, hasConversation, title, updatedAtMs }) and `store.db`
 *    (SQLite: `meta` row holds hex-encoded JSON; `blobs` is a content-addressed message store
 *    where payloads may be plaintext JSON or AES-GCM encrypted).
 */

export interface CursorParseContext {
  sessionId: string;
  project?: string;
  displayPath?: string;
  state?: SessionState;
}

export interface CursorStoreMeta {
  agentId?: string;
  latestRootBlobId?: string;
  name?: string;
  mode?: string;
  approvalMode?: string;
  createdAt?: number;
  lastUsedModel?: string;
}

export interface CursorChatMetaFile {
  title?: string;
  createdAtMs?: number;
  updatedAtMs?: number;
  hasConversation?: boolean;
}

export interface CursorStoreMessage {
  role: string;
  text: string;
  /** Workspace path embedded in <user_info> blocks, when present. */
  workspace?: string;
}

const CURSOR_USER_PROMPT_PATTERN = /<user_query>([\s\S]*?)<\/user_query>/i;
const CURSOR_WORKSPACE_PATTERN = /Workspace Path:\s*([^\r\n]+)/i;

/**
 * Removes Cursor's XML-ish envelope tags (timestamp, user_info, system-reminder, ...)
 * while keeping the human-readable text.
 */
export function stripCursorMarkup(text: string): string {
  return text
    .replace(/<timestamp>[\s\S]*?<\/timestamp>/gi, '')
    .replace(
      /<\/?(?:user_query|user_info|system-reminder|git_status|cursor_commands|command_name|command_message|additional_metadata|system-reminder)>/gi,
      ''
    )
    .replace(/<[^>]+>/g, '')
    .trim();
}

/** Extracts the workspace path Cursor embeds in <user_info> blocks. */
export function extractCursorWorkspace(text: string): string | undefined {
  const match = text.match(CURSOR_WORKSPACE_PATTERN);
  const value = match?.[1]?.trim();
  return value ? value.replace(/^["']|["']$/g, '') : undefined;
}

function findTextContent(blocks: any[]): string | undefined {
  for (const block of blocks) {
    if (block && block.type === 'text' && typeof block.text === 'string' && block.text.trim()) {
      return block.text;
    }
  }
  return undefined;
}

function findToolUses(blocks: any[]): string[] {
  const names: string[] = [];
  for (const block of blocks) {
    if (block && block.type === 'tool_use' && typeof block.name === 'string') {
      names.push(block.name);
    }
  }
  return names;
}

function toContentBlocks(content: unknown): any[] {
  if (Array.isArray(content)) return content;
  if (typeof content === 'string') return [{ type: 'text', text: content }];
  return [];
}

/**
 * Parses a single agent-transcript record into a partial AgentEvent.
 * Returns null for unknown shapes so callers can keep the previous state.
 */
export function parseCursorTranscriptRecord(record: any, context: CursorParseContext): Partial<AgentEvent> | null {
  if (!record || typeof record !== 'object') return null;

  let state: SessionState = context.state || 'working';
  let promptSnippet: string | undefined;
  let outputSnippet: string | undefined;
  let displayPath = context.displayPath || '~';
  let project = context.project || 'cursor-session';

  if (record.type === 'turn_ended') {
    const status = typeof record.status === 'string' ? record.status.toLowerCase() : '';
    const errorText = typeof record.error === 'string' ? record.error : undefined;
    if (status === 'error' || status === 'failed') {
      state = 'crashed';
    } else if (status === 'aborted' || status === 'cancelled' || status === 'canceled' || status === 'interrupted') {
      state = 'idle';
    } else {
      state = 'idle';
    }
    if (errorText) {
      outputSnippet = scrubSecrets(errorText.replace(/\s+/g, ' ').trim()).slice(0, 240);
    }
    return { state, outputSnippet, project, displayPath };
  }

  const role = typeof record.role === 'string' ? record.role : undefined;
  if (role !== 'user' && role !== 'assistant') return null;

  const blocks = toContentBlocks(record.message?.content);
  const text = findTextContent(blocks);

  if (text) {
    const workspace = extractCursorWorkspace(text);
    if (workspace) {
      displayPath = sanitizePath(workspace);
      project = path.basename(workspace.replace(/\\/g, '/')) || project;
    }
  }

  if (role === 'user') {
    state = 'working';
    if (text) {
      const promptMatch = text.match(CURSOR_USER_PROMPT_PATTERN);
      const promptBody = promptMatch ? promptMatch[1] : stripCursorMarkup(text);
      const cleaned = promptBody.replace(/\s+/g, ' ').trim();
      if (cleaned) {
        promptSnippet = scrubSecrets(cleaned).slice(0, 180);
      }
    }
  } else {
    const toolNames = findToolUses(blocks);
    if (toolNames.length > 0) {
      state = 'working';
      outputSnippet = scrubSecrets(`Using ${toolNames.join(', ')}`).slice(0, 240);
    } else {
      state = 'idle';
      if (text) {
        const cleaned = stripCursorMarkup(text).replace(/\s+/g, ' ').trim();
        if (cleaned) {
          outputSnippet = scrubSecrets(cleaned).slice(0, 240);
        }
      }
    }
  }

  return { state, promptSnippet, outputSnippet, project, displayPath };
}

/** Decodes the hex-encoded JSON stored in the store.db `meta` table. */
export function decodeCursorStoreMeta(value: unknown): CursorStoreMeta | null {
  if (typeof value !== 'string' || !/^[0-9a-f]+$/i.test(value) || value.length % 2 !== 0) return null;
  try {
    const decoded = JSON.parse(Buffer.from(value, 'hex').toString('utf8'));
    if (!decoded || typeof decoded !== 'object') return null;
    return {
      agentId: typeof decoded.agentId === 'string' ? decoded.agentId : undefined,
      latestRootBlobId: typeof decoded.latestRootBlobId === 'string' ? decoded.latestRootBlobId : undefined,
      name: typeof decoded.name === 'string' ? decoded.name : undefined,
      mode: typeof decoded.mode === 'string' ? decoded.mode : undefined,
      approvalMode: typeof decoded.approvalMode === 'string' ? decoded.approvalMode : undefined,
      createdAt: typeof decoded.createdAt === 'number' ? decoded.createdAt : undefined,
      lastUsedModel: typeof decoded.lastUsedModel === 'string' ? decoded.lastUsedModel : undefined,
    };
  } catch {
    return null;
  }
}

export function parseCursorChatMetaFile(raw: unknown): CursorChatMetaFile | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;
  return {
    title: typeof value.title === 'string' ? value.title : undefined,
    createdAtMs: typeof value.createdAtMs === 'number' ? value.createdAtMs : undefined,
    updatedAtMs: typeof value.updatedAtMs === 'number' ? value.updatedAtMs : undefined,
    hasConversation: typeof value.hasConversation === 'boolean' ? value.hasConversation : undefined,
  };
}

/**
 * Best-effort decode of one store.db blob. Plaintext message blobs look like
 * `{"role":"user","content":"..."}` or `{"role":"assistant","content":[{"type":"text","text":"..."}]}`.
 * Encrypted blobs fail JSON parsing and are skipped by the caller.
 */
export function parseCursorMessageBlob(raw: string): CursorStoreMessage | null {
  if (!raw || raw[0] !== '{') return null;
  try {
    const decoded = JSON.parse(raw);
    const role = typeof decoded?.role === 'string' ? decoded.role : undefined;
    if (!role) return null;
    const blocks = toContentBlocks(decoded.content);
    const text = findTextContent(blocks) ?? (typeof decoded.content === 'string' ? decoded.content : undefined);
    if (!text) {
      const toolUses = findToolUses(blocks);
      if (toolUses.length > 0) return { role, text: `Using ${toolUses.join(', ')}` };
      return null;
    }
    const workspace = extractCursorWorkspace(text);
    const cleaned = stripCursorMarkup(text).replace(/\s+/g, ' ').trim();
    if (!cleaned) return null;
    return { role, text: cleaned, workspace };
  } catch {
    return null;
  }
}

/**
 * Maps the most recent readable message to a lifecycle state.
 * A trailing user message means Cursor is still processing; a trailing
 * assistant message means the turn finished and the session awaits input.
 */
export function cursorStateFromMessages(messages: CursorStoreMessage[], updatedAtMs: number, nowMs: number): SessionState {
  const latest = messages.find((m) => m.role === 'user' || m.role === 'assistant');
  if (latest) {
    return latest.role === 'user' ? 'working' : 'idle';
  }
  // No readable content: fall back to file freshness.
  return nowMs - updatedAtMs < 120_000 ? 'working' : 'idle';
}
