import path from 'node:path';
import type { AgentEvent, SessionState } from '@agentstat/shared';
import { sanitizePath, scrubSecrets } from '@agentstat/shared';

export interface CodexParseContext {
  sessionId: string;
  project?: string;
  displayPath?: string;
  state?: SessionState;
}

export function parseCodexRecord(record: any, context: CodexParseContext): Partial<AgentEvent> | null {
  const payload = record?.payload ?? record;
  const type = payload?.type ?? record?.type;
  const timestamp = record?.timestamp || payload?.timestamp || new Date().toISOString();
  let state: SessionState = context.state || 'working';
  let promptSnippet: string | undefined;
  let outputSnippet: string | undefined;
  let displayPath = context.displayPath || '~';
  let project = context.project || 'codex-session';

  const cwd = payload?.cwd || payload?.working_directory || payload?.workdir || payload?.session?.cwd;
  if (typeof cwd === 'string') {
    displayPath = sanitizePath(cwd);
    project = path.basename(cwd.replace(/\\/g, '/')) || project;
  }
  if (record?.cwd && typeof record.cwd === 'string') {
    displayPath = sanitizePath(record.cwd);
    project = path.basename(record.cwd.replace(/\\/g, '/')) || project;
  }

  const text = typeof payload?.text === 'string' ? payload.text :
    typeof payload?.content === 'string' ? payload.content :
    typeof payload?.message === 'string' ? payload.message : undefined;
  if (type === 'user_message' || type === 'user_prompt' || type === 'turn.started') {
    if (text) promptSnippet = scrubSecrets(text.replace(/<[^>]+>/g, '').trim().slice(0, 180));
    state = 'working';
  } else if (type === 'agent_message' || type === 'message' || type === 'agent_message_delta') {
    if (text) outputSnippet = scrubSecrets(text.replace(/<[^>]+>/g, '').trim().slice(0, 240));
    state = type === 'agent_message_delta' ? 'working' : 'idle';
  } else if (type === 'turn.completed' || type === 'turn.ended' || type === 'task_completed') {
    state = 'idle';
  } else if (type === 'thread.started' || type === 'command_execution' || type === 'function_call' || type === 'file_change' || type === 'mcp_tool_call' || type === 'web_search') {
    state = 'working';
  } else if (type === 'error' || type === 'turn.failed' || type === 'task_failed') {
    state = 'crashed';
    if (text) outputSnippet = scrubSecrets(text.slice(0, 240));
  } else if (type === 'approval_requested' || type === 'user_input_requested' || type === 'ask_for_approval') {
    state = 'waiting_approval';
    if (text) promptSnippet = scrubSecrets(text.slice(0, 180));
  } else if (payload?.exit_code !== undefined && payload.exit_code !== 0) {
    state = 'crashed';
  }

  if (!promptSnippet && payload?.input && typeof payload.input === 'string') {
    promptSnippet = scrubSecrets(payload.input.slice(0, 180));
  }
  return { state, promptSnippet, outputSnippet, project, displayPath, timestamp };
}
