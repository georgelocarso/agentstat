---
name: grok-bot-local-mirrors
description: "Grok Bot's cloud chats have no local transcript store; the only local mirror is the desktop client's sand-client-persistence slices, and it cannot express cloud-side work."
area: agent-discovery
---

# Grok Bot local mirrors, and the ceiling of cloud-agent observability

**The problem.** AgentStat's job is to surface live agent sessions in the HUD. Grok Bot (xAI) runs each Bot on its own *cloud* computer, so the natural conclusion from its public docs is "no local data, therefore not monitorable". That conclusion is wrong — but the useful data is not where the docs or the obvious directories suggest, and finding it cost a long, mostly fruitless search.

**What is not the answer (do not repeat this search).**

| Location | What it actually holds |
| :--- | :--- |
| `~/.grokbot/` | Local-exec **bridge only**: `local-exec-daemon.json` (fresh `servingAt` heartbeat roughly every 6 s, plus `inflightCount`), `local-exec-daemon.log`, and *sealed* credential/connection blobs. No chat data. It is machine-level and cannot be attributed to a Bot. |
| `<appData>/Grok Bot/` root | Electron caches, `sentry/session.json`, sealed `gateway-descriptor.json`. `dune-reliability/**` is app boot/crash telemetry, not sessions. |
| `<appData>/Grok Bot/sand-client-persistence/*.blob` | **The only real local mirror**: a roster slice plus one transcript replica per Bot. |

"App data dir" means `%APPDATA%\Grok Bot` on Windows, `~/Library/Application Support/Grok Bot` on macOS, `~/.config/Grok Bot` on Linux — resolved by `defaultGrokBotAppDataDir()` in `packages/daemon/src/watcher/grokbot-session-watcher.ts`. Sealed files (`"sandSealedFile": 1`) are OS-protected; a local monitor cannot and should not try to read them.

**How the mirror is encoded.** Each `.blob` file name is base32 (lowercase `a-z2-7`) of the percent-encoded slice key; the payload is plain JSON shaped `{ schemaVersion, value }`. Keys look like `sand.client.slice.account.<account>.roster.last-roster` and `sand.client.slice.account.<account>.transcript.replicas.<botId>`. Decode with `decodeSliceKey()` in `packages/daemon/src/grokbot/slices.ts` rather than pattern-matching filenames.

Roster rows carry the session identity: `id`, `name`, `lastActivityAt`, `awaitingUserResponse`, `lastEntry`. Transcript replicas carry two entry shapes — `kind:"message"` with `role:"user"` is the user's prompt, and `kind:"send-message"` with `message.content` is the Bot's reply. Note that streamed progress frames are persisted as **user** messages whose content starts with `data:{`; without the `isProgressNoise()` filter the newest "user message" is a progress frame, an unanswered-prompt check never fires, and every busy Bot reads as idle.

**The state ceiling.** `deriveGrokBotSession()` maps local evidence to exactly these claims:

- `awaitingUserResponse` set → `waiting_approval`
- newest meaningful entry is an unanswered user message → `working`
- transcript written within `activityStreamMs` (15 s) → `working` (a reply is streaming in)
- otherwise → `idle`

A long cloud run *after* the Bot's last reply is indistinguishable from idle. No local field carries "still working": `lastActivityAt` is message time, `localActivityAt` is updated only for real local execution, and the bridge's `inflightCount` is machine-wide. Do not synthesise a working state from inactivity or recency — a card that claims "Working" with no evidence is worse than an honest idle one. Expect the HUD to disagree with the Grok Bot app UI during long runs, and document that rather than papering over it.

**Fragility contract.** These are undocumented client internals with no schema guarantee, and any app release may reshape them. So: parse tolerantly (unknown shapes are skipped, never thrown), stay silent rather than noisy when the directory disappears, never write into the app data dir (SQLite is opened read-only), and keep the `GROKBOT_APP_DATA` override so tests and unusual installs work. Anything richer than the ceiling above requires a documented API, not more file archaeology.

**Re-validation recipe (~2 minutes, after any Grok Bot app update).** Decode the `.blob` names and confirm `roster.last-roster` and `transcript.replicas.<id>` still exist; start a Bot turn and watch which blobs change, since whatever changes *is* the activity signal; if a new `kind` appears in `value.entries`, extend `parseTranscriptReplica`/`deriveGrokBotSession` instead of special-casing the watcher.

**Code map.**

- `packages/daemon/src/grokbot/slices.ts` — key decoding, roster/replica parsing, state derivation (pure, unit-tested)
- `packages/daemon/src/watcher/grokbot-session-watcher.ts` — polls the slices, emits one session per Bot as `grokbot_<botId>`, gated by a 7-day discovery window
- `packages/daemon/src/grokbot/bridge-events.ts` + `packages/daemon/src/watcher/grokbot-bridge-watcher.ts` — the separate machine-level bridge session (`grokbot_local`)
- Tests: `packages/daemon/src/grokbot/slices.test.ts`, `packages/daemon/src/watcher/grokbot-session-watcher.test.ts`

Adjacent, and deliberately not repeated here: Cursor's store is the opposite problem — a well-behaved append-only transcript source plus a partially encrypted `store.db` — documented in the README's supported-agents table.
