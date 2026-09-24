import os from 'node:os';

/**
 * Normalizes system paths to redact local usernames and specific host structures.
 * E.g., /Users/dev/repos/api-backend -> ~/repos/api-backend
 * C:\Users\dev\repos\api-backend -> ~/repos/api-backend
 */
export function sanitizePath(rawPath: string, customHomeDir?: string): string {
  if (!rawPath) return '~';

  const home = (customHomeDir || os.homedir?.() || '').replace(/\\/g, '/');
  let normalized = rawPath.replace(/\\/g, '/');

  // Strip trailing slashes
  if (normalized.length > 1 && normalized.endsWith('/')) {
    normalized = normalized.slice(0, -1);
  }

  // Exact home match
  if (home && normalized.toLowerCase() === home.toLowerCase()) {
    return '~';
  }

  // Subpath of home
  if (home && normalized.toLowerCase().startsWith(home.toLowerCase() + '/')) {
    return '~' + normalized.slice(home.length);
  }

  // Generic fallback if home dir pattern detected: /Users/<name>/... or C:/Users/<name>/... or /home/<name>/...
  const userPattern = /^(?:[A-Za-z]:)?(?:\/Users\/|\/home\/)[^/]+(\/.*)?$/i;
  const match = normalized.match(userPattern);
  if (match) {
    return '~' + (match[1] || '');
  }

  return normalized;
}

/**
 * Secret patterns to scrub from prompt snippets and command outputs:
 * - OpenAI/Anthropic/generic API keys (sk-..., AIza...)
 * - GitHub personal access tokens (ghp_..., gho_...)
 * - Bearer tokens and Authorization headers
 * - Generic high entropy hex/base64 tokens in auth contexts
 */
const SECRET_PATTERNS: Array<{ regex: RegExp; replacement: string }> = [
  // OpenAI API Key
  { regex: /sk-[a-zA-Z0-9_-]{20,}/g, replacement: 'sk-***[REDACTED]***' },
  // Google API Key
  { regex: /AIza[0-9A-Za-z-_]{35}/g, replacement: 'AIza***[REDACTED]***' },
  // GitHub PAT
  { regex: /gh[pousr]_[A-Za-z0-9_]{36,}/g, replacement: 'ghp_***[REDACTED]***' },
  // Generic Bearer Token
  { regex: /(Bearer\s+)[A-Za-z0-9\-._~+/]+=*/gi, replacement: '$1***[REDACTED]***' },
  // Key / Token assignments (e.g. API_KEY=xyz, token: "xyz")
  { regex: /((?:api[_-]?key|secret|token|password|auth)['"]?\s*[:=]\s*['"]?)[a-zA-Z0-9_\-.]{8,}(['"]?)/gi, replacement: '$1***[REDACTED]***$2' },
];

/**
 * Strips secret tokens and sensitive environment values from text snippets
 */
export function scrubSecrets(input: string): string {
  if (!input) return '';
  let result = input;
  for (const { regex, replacement } of SECRET_PATTERNS) {
    result = result.replace(regex, replacement);
  }
  return result;
}
