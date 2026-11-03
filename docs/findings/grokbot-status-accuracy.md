# Grok Bot Status Accuracy — Analysis

Date: 2026-11-03
Question it answers: "sometimes the status seems wrong for grokbot — can we do anything about it?"
Answer: yes. The session watcher's state derivation has two unbounded `working` paths and one noisy one. Below is the evidence chain and the fix plan. OC = `packages/daemon/src/grokbot/slices.ts`, SW = `packages/daemon/src/watcher/grokbot-session-watcher.ts`.

---

## Where the status comes from

`deriveGrokBotSession` (OC) decides per-bot state, first match wins:

1. `bot.awaitingUserResponse` → `waiting_approval`
2. newest meaningful transcript entry is a **user message with no bot reply in the replica** → `working`
3. transcript replica file `mtime` within 15 s (default `activityStreamMs`) → `working`
4. otherwise → `idle`

The bridge watcher (`~/.grokbot`, one machine-level row) is separately derived from the heartbeat + `inflightCount` and looks sound.

## Finding 1 — unbounded `working` from an unanswered prompt (HIGH)

Rule 2 has **no time bound and no reply-presence fallback**. It claims "the bot is working on it" for as long as the local replica keeps the user message last. That is wrong whenever:

- the bot's reply lives in a slice that lags or is never replicated (replies observed via `roster.lastEntry`, which rule 2 ignores), or
- the user's last message was answered in a *different* transcript replica than the one scanned, or
- the conversation simply ended without a recorded reply (error, skip, manual close).

**Live evidence (2026-11-03, HUD at 11:44 PM):** two grokbot cards rendered `Working` — `Automation-Data Weekly creations` with prompt "yes it works fine, thank!" and `PM Woex-Agent` with "greate thanks." — conversations that are plainly answered long ago. Both cards' "Active" clock kept refreshing, so the wrongness was stable, not transient.

**Fix (OC):** time-bound the unanswered-prompt claim. A bot can only be believed to be "working on it" if its roster activity is recent:

```ts
const UNANSWERED_WORK_WINDOW_MS = 10 * 60 * 1000;
const lastActivity = Math.max(bot.lastActivityAt, bot.updatedAt, 0);
if (lastMeaningful?.kind === 'message' && lastMeaningful.role === 'user') {
  if (nowMs - lastActivity <= UNANSWERED_WORK_WINDOW_MS) return { ...derivation, state: 'working' };
  // old unanswered prompt: reply likely never replicated — degrade, don't guess
  return { ...derivation }; // idle, prompt still visible
}
```

Also consult `roster.lastEntry` when the replica looks "answered": if the roster says the last entry was a bot reply while the replica still ends with the user message, trust the roster (belt-and-braces against replication lag).

## Finding 2 — `mtime` touch flips state to `working` on noise (MEDIUM)

Rule 3 treats any write to the transcript replica within 15 s as "streaming reply or new activity". But the client rewrites these blobs for non-chat reasons too (sync, unread bookkeeping, progress-frame rewrites). Symptom: a bot that is idle flashes `Working` roughly every time anything touches the file; combined with Finding 1 it *stays* wrong.

**Fix (OC/SW):** require evidence of content growth, not just a touch:

```ts
// SW keeps per-bot { eventKey, mtimeMs, entryCount }
if (entries.length === existing?.entryCount) treat as no activity (don't set working);
```

i.e. `fileMtimeMs within window AND entries.length > lastSeenCount` → `working`. Popup cards then only fire when actual messages arrive.

## Finding 3 — silent total-abort on one bad blob (MEDIUM, robustness)

SW `scan()` does `catch → return` when the roster blob fails to parse; and per-bot `catch → entries = []` turns a corrupt replica into "no transcript" — which then makes the newest-roster-`lastEntry`-is-a-user-message bot look fresh/unanswered. Related: everything here is `(raw as any)` without shape validation.

**Fix (SW/OC):** per-row defensive parsing (skip bad rows, keep good ones), one `console.warn` per failing blob with the slice key, and treat `parse failure` distinctly from `empty` (skip emissions for that bot rather than deriving from nothing).

## Finding 4 — small: emit suppression keys don't include `entryCount`

SW suppresses re-emits by `${state}|${prompt}|${output}`. After fix 2, add the entry count to the key so growth-driven transitions are not swallowed.

## Non-issues, checked

- `waiting_approval` mapping honors `awaitingUserResponse` with sensible snippet extraction — good.
- Bridge watcher (`bridge-events.ts`): heartbeat staleness (120 s), `inflightCount > 0` → working, and idle phrasing are all consistent with observed behavior; the machine-level row was never observed wrong.
- Secret scrubbing is applied to both snippets before emit.

## Verification plan (after implementation)

1. Unit tests (SW): unanswered new prompt → working; unanswered >10 min-old prompt → idle; replica touch without entry growth → not working; corrupt blob → warn + other bots unaffected.
2. Live: run the daemon, filter HUD to `grokbot`, confirm the two previously-stuck cards settle to `working`→`idle` per real activity and stop flickering on noise touches.

Related: `docs/findings/2026-11-03-repo-review.md` (A1 = this file).
