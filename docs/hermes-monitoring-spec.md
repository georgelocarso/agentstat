# Spec: Monitoring the Hermes Agent (hermes CLI) in AgentStat

Status: draft, ready to implement
Source of the approach: read-through of `C:\Data\Project_2\ruang` (Ruang · Hermes 3D Virtual Office) — `server/mission-control.ts`, `server/folders.ts`, `server/memory.ts`, README.
Target: `agentstat` daemon + HUD (packages `daemon`, `shared`, `web`).

---

## 1. Scope and goals

AgentStat should be able to monitor the local [Hermes Agent](https://hermes-agent.nousresearch.com) the same way it already monitors `agy`, `codex`, `cursor` and `grokbot`: read-only, zero-config, updating the HUD in real time.

**What we add:** discovery of Hermes profiles, a live per-agent state, recent-activity labels, and (backlogged) token/Kanban surfaces.

**What we never do:**

- **No writes to Hermes.** Ruang's hard rule applies here too: the monitor only *reads*. Every command AgentStat runs is from a fixed, read-only allowlist. There is no endpoint, no scheduler and no code path that creates, resumes, mutates or cancels anything in Hermes.
- **No driving of agents.** Nothing is *asked* of the agents from here. Hermes work is and stays initiated by the human in each agent's own CLI (or its gateway/cron, which Hermes runs itself). The daemon's CLI commands are observability probes against Hermes's own persisted state — the same "commands still happen at each agent's CLI" posture the other collectors have (they watch transcript files the agent wrote; ours shells the Hermes CLI for the same persisted, read-only facts).
- **No shell interpolation.** Browser input never reaches a command argument; only compile-time string constants do.

## 2. How Ruang does it (what we learned)

Ruang is a local web dashboard whose server is a **poller over a fixed allowlist of read-only Hermes CLI commands**, sold as "read-only mission control": it discovers agents from Hermes itself, never writes, and renders everything as normalized data.

Mechanics worth copying:

| Mechanism | Detail |
| --- | --- |
| Discovery | `hermes profile list` (plain text, no alias-parsing). Every profile = one agent (`default`, `coder`, …). New profiles appear automatically. Gateway state comes from the third column (`running`/`stopped`) of the same listing; a stopped gateway does **not** mean the agent is offline — it only means it isn't listening on messaging platforms. |
| Command execution | `execFile` only (no shell), fixed argv, `NO_COLOR=1`, `TERM=dumb`, `COLUMNS=200` piped environment, 8 s timeout, strict validation of every interpolated value. |
| Allowlist | Only these probes: `hermes profile list`, `hermes status --all`, `hermes -p <profile> logs agent -n 80 --since 3m`, `hermes -p <profile> sessions list --limit 3`, `hermes logs agent/gateway/errors -n 200`, `hermes kanban …`, `hermes -p <profile> cron list --all`, `hermes -p <profile> insights --days N`, `hermes sessions list`, `hermes skills list --enabled-only`. |
| Live activity | Per profile, the last 3 minutes of that profile's `agent.log` (via `hermes -p <profile> logs agent -n 80 --since 3m`) classify into `cron` / `tools` / `thinking` / `chat` from the logger name in the log record; a session active in the window also counts. Gateway-only lines are polling noise — they only mean "chat" when combined with agent-loop/tool lines. |
| Attribution discipline | A state may only be shown with provenance. `Idle` is only emitted when *all* inputs are fresh and unattributed; anything missing or stale is `Unknown`. Gateway running or generic sessions never independently create an active state. |
| Privacy | Profiles are named and gated; run logs are double-redacted (Hermes's own redaction + a second server pass for API keys/bearer/bot tokens); home paths shortened to `~`. |
| Performance | 10 s result cache per command (5 s logs, 60 s insights), at most 4 profiles/probes in flight, one shared in-flight read per command key. |

## 3. Architecture in agentstat terms

Add one new module, mirroring existing watcher structure:

```
packages/daemon/src/hermes/
  hermes-watcher.ts      // HermesWatcher (poller Collector)
  commands.ts            // runHermes(): execFile wrapper + allowlist invocation
  parse.ts               // profile-list, logs, sessions, status parsers
  redact.ts              // shared log redaction (or reuse privacy util)
```

The current daemon starts each collector directly in `packages/daemon/src/cli.ts` (`TranscriptWatcher`, `CodexRolloutWatcher`, …). Add:

```ts
const { HermesWatcher } = await import('./hermes/hermes-watcher.js');
const hermesWatcher = new HermesWatcher(registry);
hermesWatcher.start(); // no-ops (logs "not installed") when `hermes` is not on PATH
```

The `SessionRegistry` and `AgentEvent` contract stay untouched; the watcher simply records events like the other collectors.

### 3.1 Missing-binary handling

`runHermes` returns a typed error when `hermes` is not on `PATH` (`ENOENT`). The watcher then

1. logs one line at startup, "Hermes CLI not found — hermes collector disabled", and
2. re-probes every 30 minutes (so plugging Hermes in later requires no restart beyond the probe cadence).

## 4. Data model mapping

### 4.1 `sessionId` convention

One session per profile, stable across restarts, keyed by nothing time-varying unlike transcript sessions.

- `sessionId = hermes:<profile>`

This gives the HUD exactly what Ruang's Office gives: one row per Hermes profile (an agent), continuously updated.

### 4.2 `AgentEvent` fields

| field | value |
| --- | --- |
| `agentType` | `hermes` (blocked only if it collides with existing agents — it doesn't) |
| `project` | profile name (e.g. `default`, `coder`) |
| `displayPath` | Hermes profile folder, shortened to `~/.hermes/profiles/<profile>` |
| `gitBranch` | omitted (the CLI gate for this is `hermes -p <p> status --all` — not the source of work; deferred to backlog) |
| `promptSnippet` | latest user-facing session title from `hermes -p <profile> sessions list --limit 3`, or the latest `thinking`-kind log message. Redacted. |
| `outputSnippet` | latest trim of the profile's most recent log message classified as `chat`/`tools`/`cron`, redacted, ≤ 200 chars |
| `state` | mapping below |
| `timestamp` | now (the record is an observation) |

### 4.3 `SessionState` mapping

Backdrop: AgentStat's `SessionState` = `working | waiting_approval | completed | idle | crashed | stale`. Hermes's evidence has two levels — **capability** (a stopped/running gateway) and **behaviour** (recent log activity). An agent with no recent activity is not "offline"; it is `idle` — exactly because "a stopped gateway does not make an agent offline … many agents are used from the CLI without one".

| Evidence per profile | `SessionState` | HUD subtitle |
| --- | --- | --- |
| any activity kind in last 3 m window (`cron`/`tools`/`thinking`) | `working` | activity label |
| chat activity (`gateway` noise + `agent`/`tools` lines, or no-kinds but session list shows a session active in window) | `working` | `Replying to a chat` |
| profile unparseable / both probes failed | `stale` | `Not Available` |
| all probes fresh + no activity | `idle` | `On a break` (+ `, gateway stopped` when the profile list says so) |
| all probes fresh + no activity + profile explicitly `running` in list | `idle` | `On a break · gateway running` — do **not** upgrade to `working` |
| profile name does not satisfy the name rule (see §5.2) | ignore profile entirely | — |
| profile list read fails | `stale` for previously-seen profiles | `Profiles unavailable` |

`waiting_approval` and `crashed` are **not approvable claims** for Hermes:

- A run that `- ERROR …` lines are only `crashed` when the *most recent* log record in the window is an `ERROR` from the `agent`/`agent.loop`/`run_agent` logger **and** the separators look like a Python traceback. Anything else is `working` with the snippet. If unsure, `working` wins — this mirrors the ruang privacy rule that failed kinds stay `Unknown` rather than guessed.
- `waiting_approval` is never emitted (Hermes approval lanes are run by the human, and the CLI offer does not surface approval state in any of our allowlisted probes).

## 5. Allowlist (exact commands)

The only invocations the daemon will ever make, `execFile('hermes', argv)` with no other values:

| Probe | argv | Purpose |
| --- | --- | --- |
| discover | `['profile', 'list']` | profiles, model, gateway running/stopped |
| archive usage | `['status', '--all']` | messaging-platform names + active-session count (backlog) |
| live | `['-p', profile, 'logs', 'agent', '-n', '80', '--since', '3m']` | per-profile recent-activity window probe |
| live | `['-p', profile, 'sessions', 'list', '--limit', '3']` | session freshness signal |
| ops log | `['logs', 'agent', '-n', '200']` / `['logs','gateway','-n','200']` / `['logs','errors','-n','200']` | Logs tab (backlog) |
| usage | `['-p', profile, 'insights', '--days', '7']` | token accounting (backlog) |
| kanban | `['kanban', 'boards', 'list', '--json']`, `['kanban', '--board', slug, 'list', '--json']` | tasks (backlog) |
| cron | `['-p', profile, 'cron', 'list', '--all']` | scheduled jobs (backlog) |

Anything the backlog must add goes here as a line and needs the same review. Nothing else is callable.

### 5.1 Environment

`execFile` runs with:

```ts
{
  env: { ...process.env, NO_COLOR: '1', TERM: 'dumb', COLUMNS: '200', PYTHONIOENCODING: 'utf-8' },
  timeout: 8_000,
  maxBuffer: 16 * 1024 * 1024,   // ruang parity
  windowsHide: true,
}
```

### 5.2 Argument hardening

- **Profile name rule** `^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$` — every profile name passed to `-p` must satisfy it; everything else is skipped. This is also how options-like strings (`-p --port`) never reach the child process.
- **Board slug rule** `^[a-z0-9][a-z0-9_-]{0,63}$` — same discipline for `--board`.
- **No option-shaped values with other argv shapes.** A value that looks like a flag (`-h`, `--limit`) is rejected before layout.
- `HERMES_HOME` is read-only (and default `~/.hermes`) from the environment for the `runHermes` environment only; we do not override `HERMES_HOME`, but we do honour `HERMES_HOME` for `displayPath` shortening (`home → ~`).

## 6. Watcher loop

### 6.1 Cadences

| Loop | Interval | Notes |
| --- | --- | --- |
| heartbeat (discover + status/all-profile live probes) | 15 s default when no other collector round is forced; configurable `HERMES_POLL_INTERVAL_MS` with hard sane min 5 s | |
| profile re-discover | every 6th heartbeat (≈ 90 s) | `hermes profile list` new/renamed profiles appear automatically |
| error-exit detection | second slowest loop (1 min), reads `hermes logs errors -n 50` | one daemon-level value, not per-profile |

Same style as ruang: never more than **4 probes in flight** (`mapLimit(4)`), one combined in-flight read per probe key so concurrent timers collapse rather than stack commands.

### 6.2 Caching

- Per probe key (`hermes -p coder logs agent …`), a shared in-flight promise (1) collapses concurrent callers and (2) *serves* the last fresh result before executing again. TTLs: heartbeat probes `10_000`; `logs agent` `5_000`; `insights` `60_000`; profile list `30_000`.
- On probe failure the last *fresh* payload (≤ 30 s) is still used, and the emitted event marks `state: stale` with a subtitle `Not Available` — availability is not hidable: it must be rendered as its own chip, not silently absent.

### 6.3 Emitting

`recordEvent` is called on every collected profile *every heartbeat* — not only on changes — because AgentStat's `SessionRegistry` keeps `recordEvent` semantically idempotent (snapshot update, no duplicate history rows when snippets don't change). Emitting undocumented states in every heartbeat lets `SessionState` transitions drive the real-time HUD.

## 7. Parsing rules

The parsers style mirrors ruang's parser index, keyed by exact output traffic. Each parser is a named function and each is covered with a fixtures test (`hermes-formats.test.ts`-style: deterministic inputs, expected normalized objects).

- **Profile list** — real output (captured piped from the local install) includes a table header (`Profile`, `Model`, `Gateway`, `Alias`, `Distribution`), a box-drawing rule, and a `◆` marker prefix on the profile name. Parsers must: skip header/box-drawing rows, strip any leading decoration glyph before the name, then match rows with `^(.+?)\s+(\S+)\s+(running|stopped)(?:\s|$)/i` (name, model, gateway state); the trailing `Alias`/`Distribution` columns are ignored. Fixture captured on Windows 2026-11 — re-verify byte-for-byte on Ubuntu's first run (§11). A profile row with a model string with spaces is truncated at the first two columns; the model is a single token, model display strings with spaces are truncated to the first token.
- **Logs (activity window)** — record regex `^(\d{4}-\d{2}-\d{2}[ T][\d:,.]+)\s+[A-Z]+(?:\s+\[[^\]]*\])?\s+([\w.]+):\s?(.*)$`. Logger classifier (name → kind):
  - `cron*` → `cron`
  - `tools*`/`model_tools*` → `tools`
  - `agent`/`run_agent`/`batch_runner` → `thinking`
  - `gateway`/`hermes_plugins`/`plugins.platforms` → `chat` only when the message matches `\b(message|reply|replied|respond|inbound|outbound|received|sending|sent|chat)\b`, otherwise `gateway` (noise)
  - anything else (`hermes_cli`, `uvicorn`, `gui`) → ignored
  - Gateway-only lines count as `chat` **only** when combined with `thinking`/`tools` in the same window.
- **Sessions** — each session carries `title`, `last-active`, optionally parseable id. Freshness: session is "active in window" only when `last-active` parse resolves to `just now`/`[0-3]m ago`.
- **Redaction** — every returned snippet goes through AgentStat's existing secret-scrub (`sk-*`, `AIza*`, bearer tokens) plus a username/path pass: `homedir → ~`, `C:\Users\<name> → ~/`. Home-directory paths are shortened; token-ish substrings are dropped. Redaction runs **before** `promptSnippet`/`outputSnippet` are attached.

## 8. HUD

`agentType: 'hermes'` needs nothing structural beyond it being a valid agent type column/filter (HUD already filters per-agent-type narrowly). Grouping:

- The Session-Filter Bar automatically gains the `hermes` chip; no `default-agent` changes.
- Card header: title = profile name, tag = `hermes`, state chip, gateway sub-chip (`running` / `stopped` shown only as a `gateway stopped` subtitle on idle — never as its own state).
- Card body: promptSnippet with a profile's last session title; outputSnippet with the last classified activity; per profile, a 1-row mini "Recent labels" strip like other agents' history chords, built from the `historySummary` the registry already emits.
- Row ordering in the HUD stays default AgentStat ordering; we do not add 3-D or "office" furniture.

## 9. Tests

Mirror the tests ruang ships and wire them at package level (`packages/daemon` vitest suite):

1. **Parser fixtures** — canonical profile-list / log-record / sessions outputs (piped exact formats) → expected normalized objects; adversarial rows (empty model, missing gateway state, non-name-clean profiles, Unicode profiles).
2. **Runner unit tests** — `runHermes`
   - from-name rule: passing `--evil` as a profile name is rejected
   - ENOENT → typed *not-installed* error
   - timeout, giant-output truncation
   - env contains `NO_COLOR=1`, `TERM=dumb`, `COLUMNS=200`
3. **Watcher integration (fake clock)** — with `hermes` stubbed via a replacement handler table, key assertions:
   - a profile with `logs` kinds = [`cron`] emits `working` within one heartbeat
   - idle-only evidence endures `idle`
   - profile list gone → emits `stale`, profile never `crashed`
   - profile disappears from the list → `waiting_approval` is never emitted; the row goes `archived` after `purgeTimeoutMs`
   - cache: a repeated heartbeat inside TTL performs **no** new child processes (`count` assertion)
4. **HUD unit** — a `hermes` row: header, tag, gateway sub-chip, snippet, one history chord.

## 10. Explicit non-goals (backlog)

- **No token / usage view.** Hermes insights is per-profile, cached ≥ 60 s; it is a separate page-level feature and not a `SessionState` signal.
- **No Kanban / cron / memory / folder surfaces** in this pass. Each maps to allowlist probes — spec'd in §5 — and following PRs layer them on top of the same runner.
- **No multi-machine.** This is a single-host (`localhost`) monitor like the rest of AgentStat; remote Hermes is out of scope.

## 11. Platform notes (dev on Windows, deploy on Ubuntu)

The collector is platform-neutral by design — its inputs are filesystem facts and CLI probes only, no platform-specific APIs. Still, make these choices explicit in code so Ubuntu is a first-class target:

- **Paths.** Never hardcode separators or `C:\Users\…`. Resolve the Hermes root from the environment in this order: `HERMES_HOME` override → `os.homedir()/.hermes`. Build subpaths with `path.join`. The layout is identical on both OSes (`~/.hermes/profiles/<name>`), so the same rules apply. Display-path shortening becomes: `os.homedir() → ~` (works for both `C:\Users\x\` and `/home/x/`).
- **Binary resolution.** `execFile('hermes', …)` requires `hermes` on `PATH`. On Ubuntu that is the only caveat (install location per Hermes docs, e.g. `~/.local/bin` or `/usr/local/bin` — the daemon inherits the user's `PATH`). Windows additionally has the `.cmd`/`.bat` wrapper hazard of `execFile`; if the Windows dev box ever installs Hermes as `hermes.cmd`, resolve the absolute binary path once at startup (`which`-style `PATH`+`PATHEXT` probe) and pass it to `execFile` — on this current machine the resolved artifact is `hermes.exe`, which works as-is, but never assume it. Resolution probe is read-only.
- **Non-ASCII output.** Both builds print box-drawing/Unicode table glyphs (e.g. `◆`, `─`); the `stripAnsi` helper already handles the ANSI layer, and matching Unicode at parse time requires the parsers to be written against real output on each platform (fixture from this Windows machine was captured 2026-11; re-check on Ubuntu first run).
- **Env parity.** `NO_COLOR=1`, `TERM=dumb`, `COLUMNS=200`, `PYTHONIOENCODING=utf-8` are safe cross-platform values passed by the runner on both OSes; they are additive over the inherited environment.
- **Daemon portability.** The rest of agentstat (pnpm, Node, SSE HUD on port 4111) is already platform-neutral; the Ubuntu deploy adds no new dependency beyond `hermes` itself being installed and reachable for the user running the daemon.
- **CI.** Parser-fixture tests run anywhere (deterministic string fixtures); the runner subprocess test suite is name-platform-agnostic (`PATH`-stubbed launcher), so it runs on Ubuntu CI unchanged.

## 12. Open questions

1. Does the installed Hermes here print profile rows with colours/Unicode separators under `NO_COLOR=1 COLUMNS=200` (ruang ships a working pipe-format parser, so probably yes) — the first parser fixture should come from *this* machine's real `hermes profile list` piped output, not guessed.
2. Do we surface *agent session-scoped* metadata (the Hermes `session` with parseable id) as a *separate* AgentStat row (`hermes:<profile>#<session-id>`) in the backlog, or keep one row per profile? One row per profile is what the "who is working" HUD covers; a per-session view is a Natural follow-on but the session list already has preview in the row body.
3. The `waiting_approval` state for Grok Bot currently drives chimes/alerts. Hermes deliberately has no equivalent claim; confirm the alerts policy stays silent rather than inventing one from `ERROR` lines.
