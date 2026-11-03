import os from 'node:os';

/**
 * Redaction applied before any Hermes output becomes an AgentStat snippet:
 * secrets dropped, home paths shortened. Two principles carried over from
 * ruang: never surface a credential the agent log happens to contain, and
 * shorten personal paths so snippets stay portable.
 */

const SECRET_PATTERNS: RegExp[] = [
  /sk-[A-Za-z0-9_-]{8,}/g, // OpenAI-style keys
  /AIza[0-9A-Za-z_-]{10,}/g, // Google API keys
  /gh[pousr]_[A-Za-z0-9_-]{8,}/g, // GitHub tokens
  /(?:bearer|token)\s+[A-Za-z0-9._~-]{12,}/gi, // bearer-ish credentials
  /(?:api[_-]?key|password|secret)\s*[:=]\s*\S+/gi, // key: value pairs
];

export function redact(text: string): string {
  let value = text;
  for (const pattern of SECRET_PATTERNS) {
    value = value.replace(pattern, '[redacted]');
  }
  const home = os.homedir();
  if (home && home !== '/') {
    value = value.split(home).join('~');
  }
  // HUD snippets use forward slashes on every platform.
  return value.replace(/\\/g, '/');
}

/** Snippet cap so a log line cannot flood the HUD. */
export function snippet(text: string, max = 200): string {
  const value = redact(text.trim());
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}
