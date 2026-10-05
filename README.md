# agentstat

A lightweight local daemon and real-time dashboard companion for tracking AI coding agent sessions (`agy` / Antigravity CLI, Codex CLI, Cursor Agent CLI, Grok Bot).

---

## Features

- **Zero-Config Discovery**: Automatically monitors local `agy`, Codex, Cursor and Grok Bot sessions on your machine.
- **Real-Time Web HUD**: Live dashboard updating instantly via Server-Sent Events (SSE).
- **Interactive Status Filter Bar**: Easily filter sessions by state (`All`, `Pending Approval`, `Working`, `Idle (Ready)`, `Completed`, `Crashed`, `Archived`) and by agent type.
- **Prompt & Output Previews**: Shows user requests alongside the latest agent response in real time.
- **Audio Chimes & Push Alerts**: Plays a gentle Web Audio chime and desktop notification when an agent requires approval.
- **Privacy & Security**: Automatically sanitizes system paths (`~/...`) and scrubs secret API tokens (`sk-*`, `AIza*`, Bearer tokens).
- **LAN / Mobile Support**: Access your dashboard securely from a phone or tablet with ephemeral token authentication.

---

## Supported agents

| Agent | Local source | What AgentStat reads |
| :--- | :--- | :--- |
| `agy` (Antigravity CLI) | `~/.gemini/antigravity-cli/brain/**/transcript.jsonl` | prompts, responses, approvals |
| `codex` (OpenAI Codex CLI) | `$CODEX_HOME/sessions/**/rollout-*.jsonl` (default `~/.codex`) | prompts, responses, tools, errors |
| `cursor` (Cursor Agent CLI / agent mode) | `~/.cursor/projects/<slug>/agent-transcripts/**/*.jsonl` and `~/.cursor/chats/**/store.db` | prompts, responses, tool use, turn status |
| `grokbot` (Grok Bot desktop) | `%APPDATA%/Grok Bot/sand-client-persistence` (`~/Library/Application Support/Grok Bot` on macOS) and `~/.grokbot` | per-Bot prompts, latest reply, state; local-exec bridge activity |

Environment overrides: `CODEX_HOME`, `CURSOR_HOME`, `GROKBOT_HOME` (local-exec bridge), `GROKBOT_APP_DATA` (desktop client data dir).

Notes and limits:

- Cursor keeps hundreds of historical transcripts, so only sessions active in the last 7 days are imported on first discovery; sessions already being watched are always tracked to completion. Some `store.db` message payloads are encrypted by Cursor, so previews from that source are best-effort.
- Grok Bot agents run on xAI's cloud computers; the desktop client stores a local replica of each Bot's roster entry and recent chat, which is what AgentStat reports. Long cloud runs after the last reply cannot be observed locally, so a Bot can appear idle while it is still working remotely. Local tool execution is reported by the `~/.grokbot` bridge session.

---

## Quick Start

### 1. Install & Build
```bash
pnpm install
pnpm build
```

### 2. Start the Dashboard
```bash
pnpm dev
```
Open **[http://127.0.0.1:4111](http://127.0.0.1:4111)** in your browser.

---

## Common Commands

| Command | Description |
| :--- | :--- |
| `pnpm dev` | Starts daemon & serves Web HUD on port `4111` |
| `pnpm dev -- --port 4112` | Starts on a custom port |
| `pnpm dev -- --lan` | Enables LAN / Tailscale access with a secure auth token |
| `pnpm --filter @agentstat/daemon run dev status` | Lists active sessions directly in your terminal |
| `pnpm test` | Runs the test suite |

---

## How It Works

1. **Daemon**: Watches local agent session stores (`~/.gemini/antigravity-cli/brain`, `~/.codex/sessions`, `~/.cursor`, `~/.grokbot` and the Grok Bot desktop data dir) and streams state transitions with negligible CPU and < 50MB RAM footprint.
2. **Web HUD**: Built with React + Vite + Tailwind CSS, served directly by the local daemon.
