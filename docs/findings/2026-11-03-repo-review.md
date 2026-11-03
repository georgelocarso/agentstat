# Repo Review — AgentStat

Date: 2026-11-03
Scope: whole monorepo (`packages/shared`, `packages/daemon`, `packages/web`, docs, CI, hygiene).
Method: full read-through of daemon watchers/registry/server/auth, web app shell, package configs, test layout, git hygiene; verification runs (`pnpm -r test`, `pnpm -r build`, live daemon e2e) performed on this date.

---

## Verdict

The core is in good shape: strict TypeScript everywhere, a clean workspace layout, real test suites for the daemon and shared packages, a consistent read-only collector pattern across six agent types, secrets scrubbing at the ingestion boundary, and an SSE + React HUD that works live. Nothing here needs a rewrite. The findings below are accuracy bugs, enforcement gaps, and hygiene issues.

## A. Needs improvement

### A1. Grok Bot session status can be wrong (stuck `Working`) — HIGH, accuracy
See the dedicated write-up: [grokbot-status-accuracy.md](./grokbot-status-accuracy.md). In short:
- `deriveGrokBotSession` (`packages/daemon/src/grokbot/slices.ts`) marks a bot `working` when the newest meaningful transcript entry is an unanswered user message — with **no time bound**. If the reply never lands in the local replica, the bot shows Working forever. Live evidence on 2026-11-03: cards `Automation-Data Weekly creations` ("yes it works fine, thank!") and `PM Woex-Agent` ("greate thanks.") rendered `Working` although those are clearly *answered* conversations.
- The `fileMtimeMs` within 15 s rule can also flip a bot to `working` on sync/noise rewrites of the replica blob.

### A2. No CI enforcement of tests/build — MEDIUM, process
`.github/workflows/` contains only `pages.yml` (docs hosting). Tests exist (82 passing across `shared` + `daemon`) but nothing runs them on push/PR. Any regression lands unguarded.
**Action:** add a `ci.yml` — node 20 + pnpm, `pnpm install`, `pnpm -r build`, `pnpm -r test`. ~30 lines.

### A3. Grok Bot slice parsing is `any`-typed and fail-whole — MEDIUM, robustness
`parseRoster` / `parseTranscriptReplica` (`packages/daemon/src/grokbot/slices.ts`) cast `(raw as any)` and validate only top-level shape. One malformed blob aborts `scan()` entirely (`catch → return`), silently blanking *all* bots until the next cycle, with no log line.
**Action:** validate per-row defensively (skip bad rows, keep good ones), and log a single warning when a blob fails to parse.

### A4. Runtime artifacts pollute the repo root — MEDIUM, hygiene
`agentstat-daemon.log`, `agentstat-daemon.pid`, and the three `e2e-hermes-*.png` screenshots sit untracked in the repo root. `.gitignore` does not cover them.
**Action:** add `*.log`, `*.pid`, `e2e-*.png`, `.freebuff/` check to `.gitignore`; move future screenshots under `docs/findings/` if they should be kept.

### A5. No lint/format tooling — LOW-MEDIUM, quality
No eslint/prettier configs anywhere. Style is tidied here by hand (turn history shows repeated self-fixes for things linters catch: unused	privates, dead code, duplicate re-exports).
**Action:** add `eslint` (typescript-eslint flat config) + `prettier` (or biome) and wire into the CI job from A2. No `lint` script exists in any package today.

### A6. Repo-specific duplication across watchers — LOW-MEDIUM, maintainability
Six watchers reimplement the same scaffolding: interval+unref polling, `catch {}` swallowing, snippet capping, eventId generation, eventKey dedupe. Each new agent (hermes being the seventh) re-copies it.
**Action:** extract a small `BasePollingWatcher` (interval, emit-throttle, registry emit helper) and migrate incrementally.

## B. Nice to have

- **B1. Auth hardening (defense-in-depth)**: `TokenAuth.middleware` (`packages/daemon/src/auth.ts`) trusts a request when `req.hostname === 'localhost'` — hostname is client-controllable. It is currently unreachable as a bypass (local mode binds 127.0.0.1, LAN mode requires the token anyway), but trusting hostnames instead of socket addresses (`req.ip`/`socket.remoteAddress`) is a footgun for future deployments (e.g. reverse proxy). Also: the token travels in `?token=` (browser history, Referer) and is stored in `localStorage` — acceptable for a LAN monitor, worth a note in the README.
- **B2. Web package has zero tests** — filters, badge logic and search are pure functions worth 5–10 vitest cases; `useSSE` reconnect/backoff behavior is unverified.
- **B3. Registry event churn**: hermes emits every heartbeat by design; consider `historySummary`-style change detection at emit sites so SSE pushes are meaningful.
- **B4. Engines/toolchain declaration**: `packageManager` pins pnpm (good); add `"engines": { "node": ">=20" }` and a `.nvmrc`.
- **B5. Docs tidiness**: `docs/index.html`, `docs/e2e-review.html` are page artifacts living with design docs; a `docs/archive/` split would help. The repo also has the hermes work uncommitted (see git status) — commit the HermesWatcher + spec.
- **B6. Observability**: watcher `catch {}` blocks are silent; a single `console.warn` with the watcher name and error rate (e.g. once per N failures) would make field diagnosis much easier.
- **B7. Version/health endpoint**: `/api/health` (uptime, watcher states, last sweep age) — cheap and useful for the HUD footer.
- **B8. Structured logging**: the daemon mixes raw banners and `[watcher]` prefixes; one helper (`log.info('watcher.start', { path })`) would open the door to JSON logs without churn today.

## C. Strengths (keep doing)

- `strict` TS + NodeNext ESM across packages; type-only imports used correctly.
- Read-only collector architecture (no watcher ever drives its agent) — hermes followed the pattern cleanly with an allowlisted CLI runner.
- Real fixture-driven parser tests (claude transcript, hermes CLI output, grokbot slices, codex rollouts) — the reason the hermes collector could be built and verified in one pass.
- Secrets scrubbing (`scrubSecrets`) consistently applied at snippet boundaries.
- SessionRegistry state machine (`working/waiting_approval/completed/idle/crashed/stale` + sweep) is simple and testable.

## Suggested order

1. A1 grokbot status accuracy (user-visible wrongness — analysis ready to implement).
2. A2 CI workflow (locks in the green state we verified today).
3. A4 hygiene (.gitignore) + commit the hermes work.
4. A5 lint, then refactor only as touched (A6, A3).
5. B-items opportunistically.
