import { describe, it, expect } from 'vitest';
import { detectState } from './detector.js';

describe('detectState', () => {
  it('detects Antigravity CLI tool approval prompt', () => {
    const output = 'Allow agy to run: `npm test`? [Y/n]';
    const result = detectState(output);
    expect(result.state).toBe('waiting_approval');
    expect(result.promptSnippet).toContain('Allow agy to run: `npm test`? [Y/n]');
  });

  it('detects generic confirmation prompts with ANSI colors', () => {
    const output = '\u001b[33mDo you want to continue? [Y/n]\u001b[0m';
    const result = detectState(output);
    expect(result.state).toBe('waiting_approval');
  });

  it('detects execute command prompt', () => {
    const output = 'Agent requests: Execute command? [y/n] ';
    const result = detectState(output);
    expect(result.state).toBe('waiting_approval');
  });

  it('marks normal log streams as working', () => {
    const output = 'Reading file C:/Data/Project_2/agentstat/src/index.ts... done.\nGenerating patch...';
    const result = detectState(output);
    expect(result.state).toBe('working');
    expect(result.promptSnippet).toBeUndefined();
  });
});
