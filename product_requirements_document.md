# Product Requirements Document (PRD)

## Project: Agent Status (`agentstat`)
**Status:** In Review / PoC Scoping  
**Visibility:** Public Open-Source Repository (GitHub)  
**Primary Target for Initial PoC:** Antigravity CLI (`agy`)  

---

## 1. Executive Summary & Problem Statement

**Agent Status** is a lightweight, low-footprint monitoring daemon and real-time dashboard companion designed to track background AI coding agent sessions.

### Problem
Running terminal-based autonomous or semi-autonomous coding agents across multiple repositories, Git branches, and terminal panes introduces severe context-switching friction:
- Agents run asynchronously in background terminal windows or multiplexers (`tmux`/`zellij`).
- Agents block unpredictably waiting for tool approval or human interactive confirmation (`AskUser`, file edits, shell execution).
- Developers must constantly check terminal tabs to verify if an agent is still reasoning, halted on an approval prompt, or finished.

### Solution
A zero-friction, modular developer utility that:
1. Intercepts agent lifecycles via a transparent PTY wrapper or native hooks without modifying existing agent workflows.
2. Aggregates session states, active directories, Git branches, and approval snippets inside a local collector daemon.
3. Exposes a live, responsive Web HUD accessible locally or remotely from secondary devices (e.g., phone, tablet, secondary monitor) with immediate audio and desktop alert notifications.

---

## 2. Technical Stack Decision Matrix

### 2.1 Primary Implementation (PoC & Core Engine)
* **Architecture:** **Node.js (Hono / Express / Fastify) serving a pre-built React (Vite) SPA** OR a **single compiled Go binary embedding React static assets**.
* **Rationale:**
  * **Ultra-low memory footprint:** Idles at ~25–50 MB RAM, ensuring it can run permanently in the background without draining host machine resources.
  * **Instant cold start:** Starts in < 100ms with zero compilation or hydration overhead.
  * **Native real-time streaming:** Clean, low-latency Server-Sent Events (SSE) or WebSockets with persistent connections.
  * **Distributable binary / CLI:** Straightforward packaging into a single binary or global npm package (`npm install -g agentstat`).

### 2.2 Secondary / Post-PoC Option (Next.js Evaluation)
* **Status:** Deferred to later evaluation / alternative backend experiment.
* **Assessment:** While Next.js provides a familiar ecosystem for React development, running a persistent background Next.js server purely to monitor terminal states introduces unnecessary overhead (~120–250+ MB RAM, slower process spin-up, and SSR complexity for a strictly client-side local dashboard). It remains a secondary consideration if an enterprise multi-tenant cloud-hosted dashboard is explored later.

---

## 3. Public Repository & Security Guidelines

Because this repository will be public open source, strict guardrails are enforced to prevent credential leakage, machine fingerprinting, and Personally Identifiable Information (PII) exposure.

### 3.1 PII & Path Redaction
* **Zero Hardcoded System Paths:** Documentation and tests must never include developer usernames, local hostnames, or specific machine paths (e.g., avoid `/home/<username>` or `/Users/<username>`).
* **Path Sanitization:** The daemon automatically normalizes system paths before transmitting them to the frontend or persisting to disk:
  * Full path `/Users/dev/repos/api-backend` is sanitized to `~/repos/api-backend` or reduced to its project name `api-backend`.
* **Zero Hardcoded PII:** Generic git handles, email placeholders (`user@example.com`), and anonymized UUIDs must be used in all documentation and mocked test fixtures.

### 3.2 Network Exposure & Self-Hosting Security
* **Default Loopback Binding:** The daemon binds to `127.0.0.1` by default.
* **Multi-Device / LAN Access Mode:**
  * When the user enables LAN/remote access (`--host 0.0.0.0` or `--lan`), the daemon generates an ephemeral, cryptographically secure bearer token on startup:
    ```
    [agentstat] Listening on http://192.168.1.50:4111?token=hud_live_a1b2c3d4...
    ```
  * All REST and SSE connections from remote devices require `?token=` or an `Authorization: Bearer <token>` header to prevent unauthorized access across local shared Wi-Fi networks.
* **Prompt Scrubbing:** The PTY sniffer strips high-entropy tokens, common API key patterns (`AIza*`, `sk-*`, `ghp_*`, bearer tokens), and connection strings before emitting prompt snippets to the collector.
* **Strict `.gitignore` Policy:** `.env*`, `*.sock`, `*.db`, `.hud/`, and build artifacts are excluded by default.

---

## 4. Phased Roadmap

```
┌─────────────────────────────────────────────────────────────┐
│ Phase 1: Proof of Concept (PoC)                             │
│ Focus: Antigravity CLI (`agy`)                              │
│ • Transparent PTY interceptor (`hud run -- agy`)            │
│ • Local Collector Daemon (Node/Hono or Go)                  │
│ • Mobile-responsive Web HUD (React + Vite + SSE)            │
│ • LAN / Tailscale multi-device view with token auth         │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ Phase 2: Native Hook Integrations                           │
│ Focus: Claude Code & Hook-Native Agents                     │
│ • Native JSON lifecycle hooks (PreToolUse, Notification)    │
│ • Zero-wrapper direct HTTP dispatch                         │
│ • OSC 9 / OSC 777 terminal notification sequences           │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ Phase 3: Ecosystem Expansion & Multiplexers                 │
│ Focus: Aider, OpenCode, Codex CLI                           │
│ • Statusline plugins for `tmux` and `zellij`                │
│ • Optional standalone desktop tray/menu-bar app (Wails)     │
│ • Experimental Next.js hosted bridge evaluation             │
└─────────────────────────────────────────────────────────────┘
```

---

## 5. Phase 1 Scope: Initial PoC (`agy` Focus)

### 5.1 Target Workflow
* **Target CLI:** Antigravity CLI (`agy`)
* **Operating Systems:** Linux (x86_64, arm64), macOS (Apple Silicon / Intel).
* **Execution Paradigm:** A non-intrusive CLI wrapper spawning `agy` in an allocated pseudo-terminal:
  ```bash
  hud run -- agy [args]
  # Or via shell alias in ~/.bashrc or ~/.zshrc
  alias agy="hud run -- agy"
  ```

### 5.2 Core Components

#### A. PTY Interceptor (`hud-runner`)
* Spawns `agy` inside a virtual pseudo-terminal (using `node-pty` or Go `creack/pty`), piping raw stdin/stdout with near-zero latency (< 5ms).
* Analyzes streaming stdout to identify key agent state transitions:
  * **Approval Prompts:** Identifies interactive confirmation prompts (e.g., tool execution permission, file edit approvals, `[Y/n]`, `(y/N)`).
  * **Active Work:** Detects ongoing LLM streaming or sub-command execution.
  * **Termination:** Intercepts exit codes (clean `0` vs non-zero error).
* Extracts session metadata:
  * `sessionId`: Generated UUIDv4.
  * `project`: Extracted directory name.
  * `cwd`: Anonymized path (`~/...`).
  * `gitBranch`: Resolved via `git rev-parse --abbrev-ref HEAD`.
  * `pid`: Operating system process ID.

#### B. Local Collector Daemon (`hud-collector`)
* Lightweight server running on port `4111` (configurable).
* Binds to `127.0.0.1` by default, or `0.0.0.0` when `--lan` is specified.
* Maintains an in-memory session registry with automated cleanup:
  * Transitions inactive sessions to `stale` after 15 minutes of inactivity.
  * Purges finished sessions after 1 hour.
* Endpoints:
  * `POST /api/events`: Ingests lifecycle updates from the PTY runner.
  * `GET /api/sessions`: Returns active session state snapshots.
  * `GET /api/events/stream`: SSE pipe streaming real-time state changes to connected dashboards.

#### C. Multi-Device Responsive Web HUD
* Built with **React + Vite**, served directly by the daemon as static production assets.
* **Layout:** Responsive card grid that adapts dynamically to desktop monitors, tablets, and smartphone displays.
* **Priority Sorting:** Sessions in `waiting_approval` are highlighted in amber and pinned to the top of the interface.
* **Alert System:**
  * Configurable Web Audio chime on state transitions to `waiting_approval`.
  * Web Notifications API integration for desktop push alerts when the dashboard tab is backgrounded.

---

## 6. System State Machine & Event Schema

### 6.1 Session State Definitions
| State | Trigger Conditions | UI Visual | Alert Behavior |
| :--- | :--- | :--- | :--- |
| `working` | Streaming output tokens, sub-command running | Blue / Pulsing indicator | Silent |
| `waiting_approval` | PTY intercepts confirmation prompt | High-contrast Amber badge | Audio chime + Desktop notification |
| `completed` | Process terminates with exit code 0 | Green badge | Subtle chime (optional) |
| `crashed` | Process terminates with non-zero exit code | Red badge | Error alert |
| `stale` | No stream activity for > 15 minutes | Muted Grey | Silent |

### 6.2 Event Payload Data Contract (Sanitized)
```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "eventId": "evt_01HZ9A2B...",
  "sessionId": "agy_sess_4f8a12",
  "agentType": "agy",
  "state": "waiting_approval",
  "project": "order-service",
  "displayPath": "~/repos/order-service",
  "gitBranch": "fix/payment-race-condition",
  "promptSnippet": "Allow agy to run: `npm test`? [Y/n]",
  "timestamp": "2026-09-24T10:30:00Z"
}
```

---

## 7. Success Criteria for Phase 1 PoC

1. **Sub-millisecond PTY Overhead:** Terminal interactions with `agy` feel identical to running the binary natively (< 5ms latency impact).
2. **Reliable Prompt Interception:** Accurately catches `agy` approval prompts with < 1% false positive rate during normal code generation.
3. **Low Resource Footprint:** Combined memory usage of the daemon and Web HUD server remains < 50 MB RAM on idle.
4. **Seamless Multi-Device Experience:** Dashboard renders cleanly and streams updates reliably to a mobile browser over LAN/Tailscale with token validation.
5. **Process Isolation:** Closing, restarting, or disconnecting the Web HUD or collector daemon never terminates or interrupts active `agy` terminal processes.