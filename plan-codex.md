# Plan: Add Codex CLI support to AgentStat

## Goal

Extend AgentStat so Codex CLI sessions appear in the same dashboard and lifecycle model as agy sessions, including project/path, prompt and response previews, working/idle/approval/completed/crashed states, and live updates.

## Findings from the current codebase

AgentStat currently has two agy-specific collection paths:

1. `PtyWrapper` (`packages/daemon/src/runner/pty-wrapper.ts`) launches a command in a PTY, forwards terminal I/O, applies generic approval regexes, and posts `AgentEvent` records to `/api/events`.
2. `TranscriptWatcher` (`packages/daemon/src/watcher/transcript-watcher.ts`) polls `~/.gemini/antigravity-cli/brain/**/.system_generated/logs/transcript.jsonl`, parses agy transcript records, and writes directly to `SessionRegistry`.

The shared event and snapshot types already carry an arbitrary `agentType`, so Codex does not require a separate dashboard data model. The main coupling to agy is session discovery, transcript parsing, and the hard-coded `agentType: 'agy'` values.

## Codex integration research

- `codex exec --json` is a documented machine-readable mode. The Codex source describes JSONL events such as `thread.started`, `turn.started`, command execution, file changes, MCP calls, web search, todo updates, errors, and completion. See [codex-rs/exec/src/exec_events.rs](https://github.com/openai/codex/blob/main/codex-rs/exec/src/exec_events.rs) and [codex-rs/exec/src/cli.rs](https://github.com/openai/codex/blob/main/codex-rs/exec/src/cli.rs).
- Codex persists local rollout/session JSONL files at paths like `~/.codex/sessions/YYYY/MM/DD/rollout-<id>.jsonl`; the exact root is controlled by `CODEX_HOME`. This is confirmed by Codex discussions and issue examples, including [Discussion #12668](https://github.com/openai/codex/discussions/12668) and [Issue #18533](https://github.com/openai/codex/issues/18533).
- Codex also has an opt-in rollout trace facility (`CODEX_ROLLOUT_TRACE_ROOT`) with a local `trace.jsonl` and payload files, but it is explicitly diagnostic, opt-in, and sensitive. It should not be the default integration contract. See [rollout-trace README](https://github.com/openai/codex/blob/main/codex-rs/rollout-trace/README.md).
- Hooks are not a reliable sole source for this feature: current issue reports describe missing failure signals and version-specific behavior, including [Issue #34289](https://github.com/openai/codex/issues/34289) and [Issue #25875](https://github.com/openai/codex/issues/25875). Treat hooks as optional future enrichment, not the primary collector.

## Recommendation

Implement two Codex adapters behind a common watcher interface:

### Adapter A: Codex JSONL runner (primary for launched sessions)

Add a Codex-aware runner mode, for example `agentstat run --agent codex -- codex exec --json ...`.

- Reuse the existing PTY/stdin forwarding behavior where a terminal is needed, but parse each JSONL event before passing/displaying it.
- Prefer a pipe/stdout mode for `codex exec --json`; do not rely on terminal text heuristics when structured events are available.
- Derive a stable session ID from `thread.started` and retain the process PID as a secondary identifier.
- Map events to AgentStat states:
  - `turn.started`, active command/tool/file/MCP events => `working`.
  - A user-input/approval event, if emitted by the installed Codex version, => `waiting_approval`.
  - Final successful turn/process exit 0 => `completed`.
  - Error event or non-zero process exit => `crashed`.
  - A completed agent message with no active turn => `idle`.
- Extract `cwd`/project from the initial thread/session metadata and use the existing `sanitizePath`, `scrubSecrets`, and git helpers.
- Extract prompt text from user message events and response text from agent-message events, truncating to the existing preview limits.
- Preserve unknown event types and malformed lines in debug logs, but never fail the wrapped Codex process because the collector cannot parse one event.

### Adapter B: Codex rollout watcher (primary for already-running TUI/background sessions)

Add `CodexRolloutWatcher`, modeled on `TranscriptWatcher`, that watches:

`$CODEX_HOME/sessions/YYYY/MM/DD/rollout-*.jsonl`

with the default root `${HOME}/.codex` when `CODEX_HOME` is unset.

- Discover files recursively by date and track byte offsets plus inode/file identity so rotation and truncation are safe.
- Parse the append-only JSONL envelope and normalize both current event shapes (`event_msg`, `response_item`, and related payloads) through a version-tolerant parser.
- Use the rollout/thread ID from `session_meta` or filename as `sessionId`; set `agentType: 'codex'`.
- Read `cwd`, project, branch, user messages, agent messages, command execution, file changes, errors, and completion markers where present.
- Maintain last-known metadata when later records omit it.
- If a record contains prompt/response/tool output text, sanitize it before storing it in `AgentEvent`.
- Mark a session `stale` through the existing registry sweep when the file stops changing; do not infer completion solely from file inactivity.
- Make the root configurable for tests and installations using a non-default `CODEX_HOME`.

## Proposed implementation steps

1. **Generalize collector identity**
   - Add an agent adapter/normalizer type in `packages/daemon/src` rather than duplicating registry logic.
   - Replace agy-only comments/log messages and hard-coded event construction with an explicit `agentType` parameter.
   - Keep `AgentEvent` and `SessionSnapshot` wire compatibility unchanged.

2. **Add Codex event normalization**
   - Create `packages/daemon/src/codex/events.ts` with parsers for `codex exec --json` events and persisted rollout envelopes.
   - Define narrow internal unions for known event types, plus an `unknown` branch.
   - Add deterministic state precedence: terminal failure/completion > approval wait > active work > idle.

3. **Add the rollout watcher**
   - Create `packages/daemon/src/watcher/codex-rollout-watcher.ts`.
   - Share offset/rotation mechanics with a small generic append-only JSONL watcher utility if that reduces duplication without changing behavior.
   - Start it from `hud start` alongside the agy watcher; allow disabling or configuring roots through CLI/environment options.

4. **Add the Codex runner mode**
   - Extend `hud run` with `--agent <agy|codex|generic>` or a dedicated `hud codex` command.
   - For `codex`, require/encourage `--json` and route structured output through the Codex parser.
   - Keep generic/ag y PTY behavior intact for backward compatibility.

5. **Handle approvals conservatively**
   - First use explicit structured Codex approval/input events if available in the installed CLI.
   - Retain text heuristics only as a fallback and label them lower-confidence internally; avoid claiming approval detection when the event stream cannot distinguish it.
   - Do not depend on hooks for correctness because their contract has changed across releases and reported failures omit useful exit information.

6. **Configuration and privacy**
   - Add `CODEX_HOME`/rollout-root options to the daemon configuration and document precedence: CLI option, environment variable, then default home path.
   - Apply existing path and secret scrubbing to prompts, model output, command output, and file paths.
   - Keep rollout parsing local; never upload or tail trace payloads outside AgentStat.

7. **Tests**
   - Add fixture-driven tests for representative `codex exec --json` streams: successful turn, non-zero command, tool sequence, multiple turns, malformed/partial final line, and unknown event.
   - Add rollout watcher tests for discovery, append offsets, rotation/truncation, duplicate prevention, `CODEX_HOME`, and concurrent files.
   - Add state-mapping tests for working, idle, waiting approval, completed, crashed, and stale behavior.
   - Add server/registry tests proving `agentType: 'codex'` is preserved and mixed agy/Codex sessions sort and stream together.

## Verification and rollout

- Run the existing daemon/shared test suites plus the new Codex fixtures.
- Manually run `hud start`, then `hud run --agent codex -- codex exec --json "..."`, and confirm the dashboard receives incremental updates while the command remains active.
- Start a normal Codex TUI session with the same `CODEX_HOME`, confirm the rollout watcher discovers it without wrapping the process, and verify that restarting the daemon does not duplicate historical events.
- Test a Codex version that lacks a structured approval event; confirm the session still reports working/completed correctly and does not produce false approval alerts.
- Document the minimum Codex CLI version/ event shapes supported and expose a debug log for unsupported shapes.

## Risks and decisions to resolve during implementation

- Codex rollout schemas are internal and can evolve; isolate parsing and use tolerant payload extraction rather than coupling the registry to raw schema details.
- `codex exec --json` is the most stable integration contract for launched jobs, but it does not observe sessions that were started outside AgentStat; the rollout watcher is required for that use case.
- Approval detection may remain best-effort until Codex exposes a stable structured event. The UI should avoid presenting a false positive as an actionable approval request.
- Rollout files contain sensitive prompts, command output, and paths. Offset tracking, scrubbing, and configurable opt-out must be treated as first-class behavior.

## Suggested acceptance criteria

- A launched `codex exec --json` session appears with `agentType: codex`, project, sanitized path, prompt preview, live working state, and terminal completed/crashed state.
- An independently launched Codex session is discovered from `CODEX_HOME/sessions` and updates the same SSE/dashboard stream.
- Mixed agy and Codex sessions coexist without registry or UI changes beyond displaying the agent type.
- Partial writes, file rotation, unknown event types, and parser errors do not crash the daemon or duplicate events.
- Secrets and absolute home paths are not exposed in stored previews or dashboard payloads.

