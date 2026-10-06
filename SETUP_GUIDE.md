# AgentStat Cross-Platform & AI Agent Setup Guide

This guide describes how to run and deploy **AgentStat (`agentstat`)** on any operating system (macOS, Linux, and Windows) and provides copy-paste prompts and instructions for AI coding agents to set it up autonomously.

---

## 1. Does AgentStat Only Work on Windows?
**No. It is fully cross-platform (macOS, Linux, and Windows).**

- **Path Normalization**: All watcher paths use `os.homedir()` and Node's `path.join()`.
- **Operating System Standards**:
  - **macOS**: Reads `~/Library/Application Support/Grok Bot`, `~/.cursor`, `~/.claude`, `~/.gemini`, `~/.codex`.
  - **Linux**: Reads `~/.config/Grok Bot` (`$XDG_CONFIG_HOME`), `~/.cursor`, `~/.claude`, `~/.gemini`, `~/.codex`.
  - **Windows**: Reads `%APPDATA%/Grok Bot`, `%USERPROFILE%\.cursor`, `.claude`, `.gemini`, `.codex`.
- **Pure Node.js & Web Standards**: Uses Node 20+ (with standard `fetch`, `EventSource` / SSE, and optional `node:sqlite`).

---

## 2. Prerequisites for Other Users / Machines

Only two runtime tools are needed:
1. **Node.js**: Version `>= 20.0.0` (Node 22+ recommended for native SQLite performance).
2. **pnpm**: Version `>= 9.0.0` (or `corepack enable pnpm`).

---

## 3. Fast Human Setup (3 Steps)

```bash
# 1. Clone repository
git clone https://github.com/georgelocarso/agentstat.git
cd agentstat

# 2. Install dependencies & build
pnpm install
pnpm build

# 3. Launch dashboard
pnpm dev
```
Open **[http://127.0.0.1:4111](http://127.0.0.1:4111)**.

### Optional Flags:
- **LAN / Mobile Access**: `pnpm dev -- --lan` (prints local IP + access token for phone/tablet).
- **Custom Port**: `pnpm dev -- --port 8080`.

---

## 4. Instructions for an AI Agent to Set Up Autonomously

If you hand this repository to an AI agent (Claude Code, Cursor, Antigravity, Codex, etc.) on another machine, give it this prompt:

````markdown
Please set up and run AgentStat on my machine:

1. Check that Node.js (>= 20) and pnpm are installed:
   node -v
   pnpm -v
2. Install workspace dependencies:
   pnpm install
3. Build all workspace packages:
   pnpm build
4. Run tests to confirm integrity:
   pnpm test
5. Start the daemon in background on port 4111:
   node packages/daemon/dist/cli.js start
6. Verify health by curling http://127.0.0.1:4111/api/health
````

---

## 5. What Path Customizations Exist? (Environment Overrides)

If the user stores their agents in non-standard locations, AgentStat respects environment variables:

| Agent | Default Path | Environment Variable Override |
| :--- | :--- | :--- |
| **Claude Code** | `~/.claude/projects/` | `CLAUDE_HOME` |
| **Cursor** | `~/.cursor/` | `CURSOR_HOME` |
| **OpenAI Codex** | `~/.codex/sessions/` | `CODEX_HOME` |
| **Antigravity CLI** | `~/.gemini/antigravity-cli/brain/` | `AGY_BRAIN_DIR` |
| **Grokbot Desktop** | OS AppData / Application Support | `GROKBOT_APP_DATA` |
| **Grokbot Bridge** | `~/.grokbot/` | `GROKBOT_HOME` |

---

## 6. Planned: Web Settings Page
To make configuration easy without terminal variables, we will add a **Settings Modal/Page** (`/settings` or header gear icon ⚙️) in the Web HUD to allow users to:
1. Customize or browse watcher directory paths.
2. Toggle specific agent watchers on/off (e.g. enable Claude Code, disable Grokbot).
3. Set auto-archive timeouts and stale session thresholds.
4. Customize audio alert sounds and desktop notification frequency.
