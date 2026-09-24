# Agent Status (`agentstat`) - PoC

Lightweight, low-footprint monitoring daemon and real-time dashboard companion designed to track background AI coding agent sessions (`agy` / Antigravity CLI).

## Architecture

- `packages/shared`: Shared types, event contracts, PII path sanitization (`~/...`), and API token scrubbers.
- `packages/daemon`: CLI runner (`hud run`, `hud start`, `hud status`), PTY wrapper, prompt sniffer, in-memory session registry with automated lifecycle cleanup (15m stale / 1h purge), and SSE broadcaster.
- `packages/web`: Responsive mobile-friendly React + Vite dashboard, Web Audio chime synthesis, Web Notifications, and priority sorting.

## Quick Start

### 1. Install & Build
```bash
pnpm install
pnpm build
```

### 2. Run Tests
```bash
pnpm test
```

### 3. Start the Collector Daemon & Web HUD
```bash
# Simple single command from root:
pnpm run dev

# Or expose on LAN / Tailscale with ephemeral token auth:
pnpm run dev -- --lan
```

### 4. Run an Agent with Interception
```bash
# Intercept agy execution
pnpm --filter @agentstat/daemon run dev run -- agy
```
