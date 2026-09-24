import { describe, it, expect } from 'vitest';
import { sanitizePath, scrubSecrets } from './sanitize.js';

describe('sanitizePath', () => {
  it('normalizes Unix home directory', () => {
    const res = sanitizePath('/Users/alice/projects/agentstat', '/Users/alice');
    expect(res).toBe('~/projects/agentstat');
  });

  it('normalizes Windows home directory', () => {
    const res = sanitizePath('C:\\Users\\Bob\\repos\\api-service', 'C:\\Users\\Bob');
    expect(res).toBe('~/repos/api-service');
  });

  it('handles exact home directory', () => {
    expect(sanitizePath('/home/charlie', '/home/charlie')).toBe('~');
  });

  it('handles generic user pattern when no homeDir is provided', () => {
    expect(sanitizePath('/home/someone/code/my-app')).toBe('~/code/my-app');
  });
});

describe('scrubSecrets', () => {
  it('redacts OpenAI API keys', () => {
    const input = 'Running with OPENAI_API_KEY=sk-abc12345678901234567890def';
    expect(scrubSecrets(input)).toContain('sk-***[REDACTED]***');
    expect(scrubSecrets(input)).not.toContain('abc1234567890');
  });

  it('redacts Bearer tokens', () => {
    const input = 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.xyz';
    expect(scrubSecrets(input)).toBe('Authorization: Bearer ***[REDACTED]***');
  });

  it('redacts GitHub PATs', () => {
    const input = 'Token is ghp_123456789012345678901234567890123456';
    expect(scrubSecrets(input)).toContain('ghp_***[REDACTED]***');
  });

  it('preserves normal commands and messages', () => {
    const input = 'Allow agy to run: `npm test`? [Y/n]';
    expect(scrubSecrets(input)).toBe(input);
  });
});
