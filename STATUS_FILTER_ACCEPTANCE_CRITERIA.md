# Acceptance Criteria: Status Filter Component

## Component Overview
The **Status Filter Component** ([`StatusFilterBar.tsx`](file:///C:/Data/Project_2/agentstat/packages/web/src/components/StatusFilterBar.tsx)) is an interactive, responsive filter bar positioned between the global dashboard header and the session card grid. It allows developers to quickly isolate agent sessions based on their real-time execution states.

---

## 1. Visual & State Acceptance Criteria

### 1.1 Status Categories & Pill Badges
* [x] **Available Status Categories**: The component lists all system states plus an aggregated view:
  * **All Sessions** (`all`)
  * **Pending Approval** (`waiting_approval`)
  * **Active / Working** (`working`)
  * **Completed** (`completed`)
  * **Crashed** (`crashed`)
  * **Archived / Stale** (`stale`)
* [x] **Live Counter Pill**: Each status button displays a count badge showing the exact number of matching sessions in real time.

### 1.2 Interactive Visual States
* [x] **Default (Unselected) State**:
  * Neutral slate background (`border-slate-800`), muted label (`text-slate-400`), subtle pill badge (`bg-slate-800 text-slate-400`).
* [x] **Hover State**:
  * Smooth transition on hover (`transition-all duration-200`).
  * Icon scales subtly (`group-hover:scale-110`).
  * Text brightens with status-themed hue (e.g. amber for `waiting_approval`, blue for `working`, emerald for `completed`).
* [x] **Selected / Active State**:
  * High-contrast background with custom color coding:
    * `all`: Solid Indigo (`bg-indigo-600 text-white shadow-indigo-600/30`).
    * `waiting_approval`: Amber accent with glowing ring (`bg-amber-500/20 text-amber-300 ring-1 ring-amber-500/30`).
    * `working`: Blue accent with glowing ring (`bg-blue-600/25 text-blue-300 ring-1 ring-blue-500/30`).
    * `completed`: Emerald accent (`bg-emerald-600/25 text-emerald-300 ring-1 ring-emerald-500/30`).
    * `crashed`: Red accent (`bg-red-600/25 text-red-300 ring-1 ring-red-500/30`).
    * `stale`: Slate elevated accent (`bg-slate-700/50 text-slate-200 ring-1 ring-slate-600/40`).
* [x] **Focus State**:
  * Accessible focus ring for keyboard navigation: `focus-visible:ring-2 focus-visible:ring-indigo-400`.

---

## 2. Functional & Dynamic View Acceptance Criteria

### 2.1 Filtering & Selection
* [x] **Instant View Update**: Clicking any status filter instantly updates the grid without page reload.
* [x] **Single Select Behavior**: Selecting a new status immediately deselects the previously active filter.
* [x] **Reactive Counter Updates**: As background agents transition states (e.g., from `working` to `waiting_approval`), both the badge numbers and filtered views update in real time via SSE.

### 2.2 Empty State Handling
* [x] When a filter is selected that has zero matching sessions, a clean empty state card is displayed:
  * Example: `"No sessions found in 'waiting approval' state. Try selecting another status tab or launching a new session."`

### 2.3 Responsiveness & Accessibility
* [x] **Mobile / Small Screen Support**: The filter bar enables smooth horizontal scrolling (`overflow-x-auto scrollbar-none`) with `whitespace-nowrap` pills to accommodate mobile phones and compact displays.
* [x] **Semantic HTML & ARIA**: Uses `<nav aria-label="Filter sessions by status">`, `role="tab"`, and dynamic `aria-selected={isSelected}` attributes.
