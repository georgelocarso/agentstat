# Changelog

## 0.4.0 - 2026-10-06

### Added

- **Apple Design System Foundation**:
  - SF Pro system typography with optical letter tracking and sizing.
  - Translucent frosted glass materials (`apple-glass` with 24px blur and saturation boosts).
  - Instant direct manipulation feedback (`active:scale` with zero input lag) and spring curves.
- **Vibrant Status-Shaded Cards**:
  - Distinct high-visibility translucent gradient tints per lifecycle state (Amber for approval, Electric Blue for working, Emerald for idle, Crimson for crashed, Graphite Slate for completed).
  - Apple HIG-style material pills with glowing status indicator dots.
- **Session Detail Inspector Modal**:
  - Full-featured inspector for examining complete prompt inputs, un-truncated agent outputs, tool calls, branch names, and working paths.
  - One-click copy controls for prompts, paths, and logs.
  - Interactive approval response toolbar with quick `Approve (yes)`, `Reject (no)`, and custom reply inputs.
- **Search & Quick-Filter Toolbar**:
  - Real-time search across project names, directories, git branches, prompts, and outputs with `/` keyboard shortcut.
- **Claude Code Watcher Integration**:
  - Automatic discovery of Claude Code CLI sessions from `~/.claude/projects/**/<uuid>.jsonl`.
  - Supports permission modes (`permissionMode: ask` -> `waiting_approval`), tool call logging, and session state tracking.
- **Server-Side Metadata & Sync**:
  - `PATCH /api/sessions/:id` and `POST /api/sessions/bulk` endpoints for cross-device synchronized pins and archives.
  - `POST /api/sessions/:id/respond` interactive bridge.
- **Cross-Platform Setup Documentation**:
  - Added comprehensive `SETUP_GUIDE.md` with multi-OS support guidelines and autonomous AI agent installation prompts.

### Fixed

- Resolved modal event bubbling bug that caused inspector cards to close prematurely upon clicking.
- Added safe fallbacks for missing or unparseable timestamps.

---

## 0.3.0 - 2026-10-05

### Added

- Cursor Agent CLI session discovery from `~/.cursor/projects/**/agent-transcripts/**/*.jsonl`.
- Cursor chat store discovery from `~/.cursor/chats/**/store.db` (read-only `node:sqlite`; degrades to `meta.json` metadata on unsupported Node versions).
- Cursor transcript parsing for user prompts, assistant replies, tool use, and `turn_ended` status (`error` -> crashed, `aborted` -> idle).
- Grok Bot session discovery from the desktop client's `sand-client-persistence` roster and per-Bot transcript replicas.
- Grok Bot local-exec bridge monitoring (`~/.grokbot`) for local tool execution activity.
- Per-source discovery windows so long-lived history (hundreds of Cursor transcripts, month-old Bots) does not flood the dashboard.
- Fixture-driven tests for Cursor parsers, Cursor watcher, Grok Bot slice parsers, Grok Bot session watcher, and the bridge watcher.

### Changed

- AgentStat now starts six collectors: agy, Codex, Cursor, Grok Bot bridge, and Grok Bot sessions.
- Session events are timestamped at discovery time so recently-touched-but-finished sessions are not purged by the registry sweeper.

### Verification

- Daemon tests: 49 tests passed across 8 files.
- Full workspace build (`pnpm build`) completed successfully.
- Browser smoke test confirmed all-agents, cursor, and grokbot filtering with live sessions and prompt/output previews.

## 0.2.0 - 2026-09-25

### Added

- Automatic Codex CLI session discovery from `CODEX_HOME/sessions`.
- Codex rollout event parsing for prompts, responses, tools, errors, and lifecycle states.
- Live dashboard support for mixed agy and Codex sessions.
- Extensible Agent dropdown filter with counts for each detected agent type.
- Session pinning and improved archived session handling.

### Changed

- AgentStat now starts the Codex rollout watcher with the existing agy watcher.
- Session archiving uses the one-hour stale timeout consistently.

### Verification

- Daemon tests: 7 tests passed.
- Web production build completed successfully.
- Browser smoke test confirmed All agents, agy, and codex filtering.
