import { describe, it, expect } from 'vitest';
import {
  cursorStateFromMessages,
  decodeCursorStoreMeta,
  extractCursorWorkspace,
  parseCursorChatMetaFile,
  parseCursorMessageBlob,
  parseCursorTranscriptRecord,
  stripCursorMarkup,
} from './events.js';

const context = {
  sessionId: 'cursor_test',
  project: 'woex-agentcore',
  displayPath: '~/repos/woex-agentcore',
  state: 'working' as const,
};

describe('parseCursorTranscriptRecord', () => {
  it('maps a user record to working with a cleaned prompt snippet', () => {
    const record = {
      role: 'user',
      message: {
        content: [
          {
            type: 'text',
            text: '<timestamp>Wednesday, Sep 16, 2026</timestamp>\n<user_query>\ncode review changes on our branch\n</user_query>',
          },
        ],
      },
    };

    const parsed = parseCursorTranscriptRecord(record, context);
    expect(parsed?.state).toBe('working');
    expect(parsed?.promptSnippet).toBe('code review changes on our branch');
  });

  it('extracts the workspace path from user_info blocks', () => {
    const record = {
      role: 'user',
      message: {
        content: [
          {
            type: 'text',
            text: '<user_info>\nOS Version: win32\nWorkspace Path: C:\\Data\\Project\\woex-agentcore\n</user_info>\n<user_query>fix the tests</user_query>',
          },
        ],
      },
    };

    const parsed = parseCursorTranscriptRecord(record, context);
    expect(parsed?.displayPath?.endsWith('Data/Project/woex-agentcore')).toBe(true);
    expect(parsed?.project).toBe('woex-agentcore');
    expect(parsed?.promptSnippet).toBe('fix the tests');
  });

  it('maps an assistant record with tool calls to working', () => {
    const record = {
      role: 'assistant',
      message: {
        content: [
          { type: 'text', text: 'Reading the referenced files.' },
          { type: 'tool_use', name: 'Read', input: { path: 'src/index.ts' } },
        ],
      },
    };

    const parsed = parseCursorTranscriptRecord(record, context);
    expect(parsed?.state).toBe('working');
    expect(parsed?.outputSnippet).toContain('Using Read');
  });

  it('maps a final assistant message without tool calls to idle', () => {
    const record = {
      role: 'assistant',
      message: { content: [{ type: 'text', text: 'Done — branch merged.' }] },
    };

    const parsed = parseCursorTranscriptRecord(record, context);
    expect(parsed?.state).toBe('idle');
    expect(parsed?.outputSnippet).toBe('Done — branch merged.');
  });

  it('maps turn_ended error to crashed and aborted to idle', () => {
    const crashed = parseCursorTranscriptRecord(
      { type: 'turn_ended', status: 'error', error: "You've reached your monthly usage limit" },
      context
    );
    expect(crashed?.state).toBe('crashed');
    expect(crashed?.outputSnippet).toContain('monthly usage limit');

    const aborted = parseCursorTranscriptRecord(
      { type: 'turn_ended', status: 'aborted', error: 'User aborted/interrupted manually.' },
      context
    );
    expect(aborted?.state).toBe('idle');
  });

  it('ignores unknown record shapes', () => {
    expect(parseCursorTranscriptRecord({ type: 'something_else' }, context)).toBeNull();
    expect(parseCursorTranscriptRecord(null, context)).toBeNull();
  });
});

describe('cursor store helpers', () => {
  it('decodes the hex-encoded store.db meta row', () => {
    const payload = {
      agentId: 'f095fe79-e8b8-48a5-af2d-c86015cdd643',
      name: 'Merge Latest Preview',
      approvalMode: 'unrestricted',
      lastUsedModel: 'grok-4.6',
      createdAt: 1788769454029,
    };
    const hex = Buffer.from(JSON.stringify(payload), 'utf8').toString('hex');

    const meta = decodeCursorStoreMeta(hex);
    expect(meta?.agentId).toBe('f095fe79-e8b8-48a5-af2d-c86015cdd643');
    expect(meta?.name).toBe('Merge Latest Preview');
    expect(meta?.lastUsedModel).toBe('grok-4.6');
  });

  it('rejects non-hex meta values', () => {
    expect(decodeCursorStoreMeta('not-hex')).toBeNull();
    expect(decodeCursorStoreMeta(undefined)).toBeNull();
  });

  it('parses meta.json and message blobs', () => {
    const chatMeta = parseCursorChatMetaFile({
      schemaVersion: 1,
      createdAtMs: 1780556795393,
      hasConversation: true,
      title: 'Workflow Auditor',
      updatedAtMs: 1780557516140,
    });
    expect(chatMeta?.title).toBe('Workflow Auditor');
    expect(chatMeta?.updatedAtMs).toBe(1780557516140);

    const message = parseCursorMessageBlob(
      JSON.stringify({ role: 'assistant', content: [{ type: 'text', text: 'Creating the Next.js app.' }] })
    );
    expect(message).toEqual({ role: 'assistant', text: 'Creating the Next.js app.', workspace: undefined });

    // Encrypted payloads are not JSON and must be skipped.
    expect(parseCursorMessageBlob('\u0000\u0012\u00ab\u0009garbage')).toBeNull();
  });

  it('derives state from the newest readable message role', () => {
    expect(cursorStateFromMessages([{ role: 'user', text: 'do it' }], 0, 1)).toBe('working');
    expect(cursorStateFromMessages([{ role: 'assistant', text: 'done' }], 0, 1)).toBe('idle');
    // No readable messages: fall back to recency.
    expect(cursorStateFromMessages([], 1000, 1000 + 1000)).toBe('working');
    expect(cursorStateFromMessages([], 0, 10 * 60 * 1000)).toBe('idle');
  });

  it('strips markup and extracts workspace paths', () => {
    expect(stripCursorMarkup('<timestamp>now</timestamp><user_query>hello</user_query>')).toBe('hello');
    expect(extractCursorWorkspace('Workspace Path: C:/Data/Project/app\nShell: bash')).toBe('C:/Data/Project/app');
  });
});
