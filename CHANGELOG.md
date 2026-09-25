# Changelog

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
