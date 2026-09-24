import type { SessionState } from '@agentstat/shared';

export interface DetectionResult {
  state: SessionState;
  promptSnippet?: string;
}

/**
 * Patterns that indicate the agent is paused waiting for user approval or confirmation
 */
const APPROVAL_PATTERNS: RegExp[] = [
  // Antigravity CLI / general agent approval prompts
  /Allow\s+agy\s+to\s+run:\s*[`"']?(.*?)['"`]?\s*(\[\s*[Yy]\s*\/\s*[Nn]\s*\]|\(\s*[Yy]\s*\/\s*[Nn]\s*\))/i,
  /Execute\s+command\??\s*(\[\s*[Yy]\s*\/\s*[Nn]\s*\]|\(\s*[Yy]\s*\/\s*[Nn]\s*\))/i,
  /Approve\s+(?:execution|tool|action|change)\??\s*(\[\s*[Yy]\s*\/\s*[Nn]\s*\]|\(\s*[Yy]\s*\/\s*[Nn]\s*\))/i,
  /Apply\s+(?:these|the)?\s*changes\??\s*(\[\s*[Yy]\s*\/\s*[Nn]\s*\]|\(\s*[Yy]\s*\/\s*[Nn]\s*\))/i,
  // Standard generic interactive confirmation cues at line end
  /\[\s*y\s*\/\s*n\s*\]\s*[:?]?\s*$/i,
  /\(\s*y\s*\/\s*n\s*\)\s*[:?]?\s*$/i,
  /\[\s*yes\s*\/\s*no\s*\]\s*[:?]?\s*$/i,
  /Press\s+Enter\s+to\s+(?:continue|confirm|proceed)/i,
  /\?\s*\(Y\/n\)/i,
  /Do you want to continue\?\s*\[Y\/n\]/i,
];

// Clean ANSI escape sequences for regex parsing
const ANSI_REGEX = /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g;

export function stripAnsi(str: string): string {
  return str.replace(ANSI_REGEX, '');
}

export function detectState(outputChunk: string, currentBuffer = ''): DetectionResult {
  const combined = (currentBuffer + '\n' + outputChunk).slice(-2000); // Last 2000 characters
  const clean = stripAnsi(combined);
  const lines = clean.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const tail = lines.slice(-4).join(' ');

  // Test against approval patterns
  for (const pattern of APPROVAL_PATTERNS) {
    const match = tail.match(pattern);
    if (match) {
      return {
        state: 'waiting_approval',
        promptSnippet: match[0].trim(),
      };
    }
  }

  // Active generation or execution
  return {
    state: 'working',
  };
}
