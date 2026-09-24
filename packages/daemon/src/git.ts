import { execSync } from 'node:child_process';
import path from 'node:path';

export function getGitBranch(cwd: string): string | undefined {
  try {
    const branch = execSync('git rev-parse --abbrev-ref HEAD', {
      cwd,
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf-8',
    }).trim();
    return branch || undefined;
  } catch {
    return undefined;
  }
}

export function getProjectName(cwd: string): string {
  try {
    const root = execSync('git rev-parse --show-toplevel', {
      cwd,
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf-8',
    }).trim();
    if (root) {
      return path.basename(root);
    }
  } catch {
    // ignore
  }
  return path.basename(path.resolve(cwd)) || 'agent-session';
}
