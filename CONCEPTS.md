# Concepts

Vocabulary seeded incrementally by `ce-compound`. This file currently covers the `agent-discovery` area only; it is not a repo-wide glossary.

## agent-discovery

- **Agent type** — the label the HUD groups sessions by (`agy`, `codex`, `cursor`, `grokbot`), carried on every `AgentEvent`.
- **Collector (watcher)** — a process that discovers agent sessions from a local source and writes `AgentEvent` records into the `SessionRegistry`.
- **Local mirror** — a client-side copy of cloud-hosted agent state. The only thing a local collector can ever observe, and its fidelity bounds what the HUD may claim.
- **Slice** — one persisted key/value blob written by the Grok Bot desktop client under `sand-client-persistence`; the file name is a base32-encoded key.
- **Roster** — the slice listing every Bot with `lastActivityAt`, `awaitingUserResponse`, and `lastEntry`; the discovery source for Bot sessions.
- **Transcript replica** — the per-Bot slice holding a replica of the chat transcript (user prompts and Bot replies).
- **Sealed file** — a client file marked `"sandSealedFile": 1` whose contents are OS-protected and unreadable to a monitor.
- **Discovery window** — how far back a collector imports history on first sight. Long-lived agent data dirs (hundreds of Cursor transcripts, month-old Bots) otherwise flood the HUD.
- **Observability ceiling** — the strongest state claim the available local evidence supports. Anything beyond it is a guess, and should not be shipped as a state.
