# AgentStat Roadmap & TODO

This document outlines planned improvements and architectural additions for AgentStat.

---

## 1. Claude Code Watcher Integration
- [x] **Data Source Discovery**:
  - Watch `~/.claude/projects/**/<session-uuid>.jsonl` transcripts.
  - Parse session envelope headers (`sessionId`, `leafUuid`, timestamps, cwd).
  - Track assistant tool execution, user questions, and prompt inputs.
- [x] **Approval & Waiting Detection**:
  - Detect user prompt pauses, tool confirmation prompts, and permissions modes (`"permissionMode": "ask"` vs `"auto"`).
- [x] **Daemon Watcher Adapter**:
  - Implement `ClaudeSessionWatcher` in `packages/daemon/src/watcher/claude-session-watcher.ts`.
  - Add path normalization for Windows / macOS / Linux `~/.claude` paths.
  - Started automatically alongside Codex, Cursor, and Grokbot watchers.

---

## 2. Real-Time Questions & Answers Support (Interactive Bridge)
> **Can we support real-time questions and answers?**
> **Yes.** We support both passive observation and active responses:

- [x] **Passive Real-Time Q&A Tracking (Observer Mode)**:
  - Extract the exact pending question/permission request from the agent transcript (`waiting_approval` with options/prompt text).
  - Display the prompt question and expected format in the Session Card and Inspector.
  - Stream answers and agent responses in real time over SSE.
- [x] **Active Interactive Answering (Control Mode)**:
  - Add an interaction endpoint on daemon: `POST /api/sessions/:id/respond { answer: string }`.
  - Add quick action buttons on the Web HUD (e.g., `Approve (yes)`, `Reject (no)`, and a custom text response input in `SessionDetailModal`).

---

## 3. Search & Quick-Filter Bar
- [x] **Search Input in Web HUD**:
  - Instant text filtering by:
    - Project name (`project`)
    - Relative/absolute path (`displayPath`, `cwd`)
    - Git branch (`gitBranch`)
    - Prompt & response content snippets
  - Clear button and keyboard shortcut (`/` to focus search).
- [x] **Integration with Status & Agent Filters**:
  - Keep search filters reactive alongside existing agent type and state filters.

---

## 4. Session Detail Drawer & Full Log Inspector
- [x] **Drawer / Modal View**:
  - Click on a session card's "Inspect" button to open the full modal dialog.
- [x] **Full Message & Prompt History**:
  - View multi-turn conversation logs and full un-truncated user requests.
  - Formatted pre-wrap output log rendering with copy controls.
- [x] **Quick Action Toolbar**:
  - "Copy Prompt", "Copy Session Path", and "Copy Output" buttons.
  - Pin, archive, and interactive response controls.

---

## 5. Server-Side Pin & Archive Sync (Multi-Device & Tab Sync)
- [x] **Daemon Endpoints**:
  - `PATCH /api/sessions/:id { pinned?: boolean, archived?: boolean }`
  - `POST /api/sessions/bulk { ids: string[], action: 'archive' | 'unarchive' | 'pin' | 'unpin' }`
- [x] **Session Registry Metadata**:
  - Store and preserve `pinned` and `archived` attributes directly on `SessionSnapshot`.
  - Broadcast updates instantly over SSE to all connected HUD clients.
