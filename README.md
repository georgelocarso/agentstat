# agentstat

A lightweight local daemon and real-time dashboard companion for tracking AI coding agent sessions (`agy` / Antigravity CLI).

---

## Features

- **Zero-Config Discovery**: Automatically monitors all background `agy` agent sessions on your machine.
- **Real-Time Web HUD**: Live dashboard updating instantly via Server-Sent Events (SSE).
- **Interactive Status Filter Bar**: Easily filter sessions by state (`All`, `Pending Approval`, `Working`, `Idle (Ready)`, `Completed`, `Crashed`, `Archived`).
- **Prompt & Output Previews**: Shows user requests alongside the latest agent response in real time.
- **Audio Chimes & Push Alerts**: Plays a gentle Web Audio chime and desktop notification when an agent requires approval.
- **Privacy & Security**: Automatically sanitizes system paths (`~/...`) and scrubs secret API tokens (`sk-*`, `AIza*`, Bearer tokens).
- **LAN / Mobile Support**: Access your dashboard securely from a phone or tablet with ephemeral token authentication.

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

1. **Daemon**: Watches local agent transcript logs (`~/.gemini/antigravity-cli/brain`) and streams state transitions with negligible CPU and < 50MB RAM footprint.
2. **Web HUD**: Built with React + Vite + Tailwind CSS, served directly by the local daemon.
