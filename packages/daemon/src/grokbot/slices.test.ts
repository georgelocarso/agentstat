import { describe, it, expect } from 'vitest';
import {
  decodeSliceKey,
  deriveGrokBotSession,
  parseRoster,
  parseTranscriptReplica,
} from './slices.js';

export function encodeSliceKey(key: string): string {
  const encoded = encodeURIComponent(key);
  const bytes = Buffer.from(encoded, 'utf8');
  const alphabet = 'abcdefghijklmnopqrstuvwxyz234567';
  let bits = '';
  for (const byte of bytes) bits += byte.toString(2).padStart(8, '0');
  let out = '';
  for (let i = 0; i < bits.length; i += 5) {
    out += alphabet[parseInt(bits.slice(i, i + 5).padEnd(5, '0'), 2)];
  }
  return out;
}

describe('decodeSliceKey', () => {
  it('round-trips encoded persistence keys', () => {
    const key = 'sand.client.slice.account.auth0|user_01ABC.transcript.replicas.12818fb2-5ba9-4639-9440-d22a14cd3ad5';
    expect(decodeSliceKey(`${encodeSliceKey(key)}.blob`)).toBe(key);
    expect(decodeSliceKey('not-base32-!!')).toBeNull();
  });
});

describe('Grok Bot roster and transcript parsing', () => {
  const roster = {
    schemaVersion: 4,
    value: {
      rows: [
        {
          id: '12818fb2-5ba9-4639-9440-d22a14cd3ad5',
          name: 'Implementor',
          description: 'Fast local debugger',
          lastActivityAt: 1791171930065,
          awaitingUserResponse: null,
          lastEntry: { kind: 'text', text: 'The rerun has started.' },
          isHiddenFromSidebar: false,
        },
      ],
    },
  };

  it('parses roster rows', () => {
    const rows = parseRoster(roster);
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('Implementor');
    expect(rows[0].lastEntry?.text).toBe('The rerun has started.');
  });

  it('parses transcript entries', () => {
    const entries = parseTranscriptReplica({
      value: {
        entries: [
          { kind: 'message', role: 'user', content: 'rerun the tests' },
          { kind: 'send-message', message: { type: 'text', content: 'On it.' } },
        ],
      },
    });
    expect(entries).toHaveLength(2);
  });
});

describe('deriveGrokBotSession', () => {
  const bot = { id: 'b1', name: 'Implementor' };

  it('maps an unanswered user message to working with the prompt', () => {
    const derived = deriveGrokBotSession({
      bot,
      entries: [
        { kind: 'send-message', message: { type: 'text', content: 'Previous reply' } },
        { kind: 'message', role: 'user', content: 'rerun full workflow automation test' },
        { kind: 'message', role: 'user', content: 'data:{"event":"progress","progress_kind":"thinking"}' },
      ],
      fileMtimeMs: 0,
      nowMs: 10_000_000,
    });

    expect(derived.state).toBe('working');
    expect(derived.promptSnippet).toBe('rerun full workflow automation test');
    expect(derived.outputSnippet).toBe('Previous reply');
  });

  it('maps a trailing bot reply to idle', () => {
    const derived = deriveGrokBotSession({
      bot,
      entries: [
        { kind: 'message', role: 'user', content: 'do the work' },
        { kind: 'send-message', message: { type: 'text', content: 'Done — report is ready.' } },
      ],
      fileMtimeMs: 0,
      nowMs: 10_000_000,
    });

    expect(derived.state).toBe('idle');
    expect(derived.outputSnippet).toBe('Done — report is ready.');
  });

  it('treats fresh transcript writes as working', () => {
    const derived = deriveGrokBotSession({
      bot,
      entries: [{ kind: 'send-message', message: { type: 'text', content: 'Working on it' } }],
      fileMtimeMs: 9_999_000,
      nowMs: 10_000_000,
      activityStreamMs: 5000,
    });
    expect(derived.state).toBe('working');
  });

  it('flags awaitingUserResponse as waiting_approval', () => {
    const derived = deriveGrokBotSession({
      bot: { ...bot, awaitingUserResponse: { text: 'Approve pushing to main?' } },
      entries: [],
      fileMtimeMs: 0,
      nowMs: 10_000_000,
    });
    expect(derived.state).toBe('waiting_approval');
    expect(derived.promptSnippet).toBe('Approve pushing to main?');
  });

  it('scrubs secrets from snippets', () => {
    const derived = deriveGrokBotSession({
      bot,
      entries: [{ kind: 'message', role: 'user', content: 'use API_KEY=supersecretvalue123' }],
      fileMtimeMs: 0,
      nowMs: 10_000_000,
    });
    expect(derived.promptSnippet).not.toContain('supersecretvalue123');
    expect(derived.promptSnippet).toContain('[REDACTED]');
  });
});
