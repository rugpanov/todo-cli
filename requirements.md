# TODO Tracker — Requirements Document

## Executive Summary

A **no-code TODO tracker** with the following key features:

| Feature | Description |
|---------|-------------|
| **Source of Truth** | Notion database (Title, Due Date, Priority P0-P4, Status) |
| **Automation** | Make.com scenarios (no custom code) |
| **Daily Notification** | 7:30 AM CET — Overdue, Today, Next 2 Days, Completed Yesterday |
| **Weekly Report** | Sunday 6:00 PM CET — Stats, completed tasks, upcoming week |
| **Telegram Commands** | `/add`, `/list`, `/done <id>`, `/snooze <id>` |
| **Defaults** | Due date: tomorrow, Priority: P1 |
| **Confirmations** | Always confirm Telegram actions |
| **Errors** | Brief error messages |
| **Timezone** | CET (including weekends) |

---

## Project Overview

A serverless TODO tracker using **Notion** as the source of truth, **Make.com** for automation, and **Telegram** for notifications and task management.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Make.com                                │
│                                                                 │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────────┐  │
│  │   Notion     │◀──▶│  Scenarios   │◀──▶│  Telegram Bot    │  │
│  │  (tasks DB)  │    │ (automation) │    │  (notifications) │  │
│  └──────────────┘    └──────────────┘    └──────────────────┘  │
│                                                                 │
│  ┌──────────────┐                                               │
│  │  Scheduler   │ ── 7:30 AM CET (daily)                        │
│  │              │ ── Sunday 6:00 PM CET (weekly)                │
│  └──────────────┘                                               │
└─────────────────────────────────────────────────────────────────┘
```

---

## Functional Requirements

### FR-1: Notion Database Structure

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| **Title** | Title | ✅ Yes | Task name/description |
| **Due Date** | Date | No | When the task is due |
| **Priority** | Select | No | P0 (highest), P1, P2, P3, P4 (lowest) |
| **Status** | Select | ✅ Yes | Todo, Done |
| **Parent Task** | Relation | No | Reference to parent task (for subtasks) |

**Priority Levels:**
- **P0** — Emergency / Drop everything
- **P1** — High priority
- **P2** — Medium priority
- **P3** — Low priority
- **P4** — Someday / Nice to have

**Subtasks:**
- Any task can have subtasks by creating new tasks with a **Parent Task** relation
- Subtasks inherit the parent's due date and priority by default (can be overridden)
- A parent task is considered "Done" only when all subtasks are "Done"
- Subtasks are displayed indented under their parent in notifications

---

### FR-2: Daily Morning Notification (7:30 AM CET)

**Schedule:** Every day at 7:30 AM CET (including weekends)

**Message Format:**
```
☀️ Good morning! Here's your task overview:

🔴 OVERDUE (X tasks)
• [P1] Task title — was due Jan 30
  └ Subtask 1
  └ Subtask 2
• [P2] Another task — was due Jan 29

📅 TODAY (X tasks)
• [P1] Important meeting prep
  └ Prep slides
  └ Review agenda
• [P3] Review documents

📆 NEXT 2 DAYS (X tasks)
• [P2] Submit report — due Feb 2
• [P4] Call dentist — due Feb 3

✅ COMPLETED YESTERDAY (X tasks)
Great job! You finished:
• Task you completed
• Another finished task

Have a productive day! 💪
```

**Behavior:**
- Groups: Overdue → Today → Next 2 Days → Completed Yesterday
- Sorting within groups: By priority (P0 first)
- Empty groups are hidden
- If no tasks at all: "🎉 No pending tasks! Enjoy your day."
- If >10 tasks in a group: Show first 10 + "...and X more"

---

### FR-3: Weekly Report (Sunday 6:00 PM CET)

**Schedule:** Every Sunday at 6:00 PM CET

**Message Format:**
```
📊 Weekly Review — Week of Jan 27 - Feb 2

✅ COMPLETED THIS WEEK (X tasks)
• Task 1
• Task 2
• Task 3

📋 STILL PENDING (X tasks)
• [P1] Overdue task — was due Jan 28
• [P2] Task for next week — due Feb 5

📈 STATS
• Completion rate: X%
• Tasks completed: X
• Tasks added: X

🎯 UPCOMING NEXT WEEK (X tasks)
• [P1] Important deadline — due Feb 4
• [P2] Meeting prep — due Feb 6

Have a great week ahead! 🚀
```

**Behavior:**
- Summarizes the past 7 days
- Shows productivity stats
- Previews upcoming week's tasks
- Helps with weekly planning/review

---

### FR-4: Telegram → Notion Commands (Two-Way)

| Command | Description | Example |
|---------|-------------|---------|
| `/add <task>` | Add new task (due tomorrow, P1 priority) | `/add Buy groceries` |
| `/add <task> tomorrow` | Add task with due date | `/add Submit report tomorrow` |
| `/add <task> YYYY-MM-DD` | Add task with specific date | `/add Meeting 2026-02-15` |
| `/add [P1] <task>` | Add task with priority | `/add [P1] Fix critical bug` |
| `/add [P2] <task> tomorrow` | Add with priority and date | `/add [P2] Review PR tomorrow` |
| `/list` | Show today's tasks | `/list` |
| `/done <task_id>` | Mark task as complete | `/done abc123` |
| `/snooze <task_id>` | Push task to tomorrow | `/snooze abc123` |
| `/subtask <parent_id> <task>` | Add subtask to existing task | `/subtask 2 Review section A` |
| `/token [name]` | Generate API token for CLI | `/token laptop` |
| `/revoke [id]` | List or revoke API tokens | `/revoke 5` |

**Task ID:** Each task in notifications should include a short ID (from Notion page ID) for easy reference.

**Task Completion Flow:**
- User receives morning notification with task IDs
- User replies with `/done <task_id>` to mark complete
- Bot confirms: "✅ Marked as done: <task title>"

---

### FR-5: Obsidian Sync (Optional)

**Purpose:** Two-way sync between Supabase and a local Markdown file for editing in Obsidian.

**Components:**
- **Export (Supabase → Obsidian):** Make.com exports tasks to `.md` file via cloud sync (Dropbox/iCloud)
- **Import (Obsidian → Supabase):** Local Go watcher syncs edits back to Supabase

**Markdown Format:**
```markdown
# TODO List

## Overdue
- [ ] [P1] Fix bug — was due Jan 30

## Today
- [ ] [P1] Meeting prep
  - [ ] Prep slides
  - [ ] Review agenda

## Upcoming
- [ ] [P2] Submit report — due Feb 2
```

**Go Watcher:**
- Uses `fsnotify` for file watching
- Uses `supabase-go` for API calls
- Parses `- [ ]` / `- [x]` checkbox changes
- Debounces changes (1-2 sec delay)
- Runs as background service

**Sync Rules:**
- Supabase is source of truth
- Last-write-wins for conflicts
- Checkbox toggle → status change
- New lines → new tasks (optional)

---

### FR-6: Token-Based Authentication

**Purpose:** Allow CLI tools to authenticate without exposing service role keys.

**Database Schema:**

| Property | Type | Description |
|----------|------|-------------|
| **id** | SERIAL | Primary key |
| **user_id** | TEXT | Telegram Chat ID of token owner |
| **token_hash** | TEXT | SHA-256 hash of the token (unique) |
| **name** | TEXT | User-friendly token name |
| **created_at** | TIMESTAMPTZ | Token creation time |
| **expires_at** | TIMESTAMPTZ | Token expiration (default: 1 year) |

**Token Flow:**
1. User sends `/token [name]` to Telegram bot
2. Bot generates random token (UUID-based)
3. Bot stores SHA-256 hash in `api_tokens` table
4. Bot sends plaintext token to user (shown once only)
5. User saves token to `~/.todo-cli-token` or `TODO_CLI_TOKEN` env var

**CLI Authentication:**
1. CLI reads token from `~/.todo-cli-token` or `TODO_CLI_TOKEN`
2. CLI calls `auth-verify` edge function with token in Authorization header
3. Edge function hashes token, looks up in database
4. If valid and not expired, returns `user_id`
5. CLI uses `user_id` for all subsequent API calls

**Token Management:**
- `/revoke` — List all user's tokens with IDs
- `/revoke <id>` — Delete specific token

---

### FR-7: Real-time Notifications

**Status:** Not required (disabled)

No real-time alerts for:
- Task becoming overdue
- High-priority task added
- Reminders before due time

---

### FR-8: Timezone & Schedule

| Setting | Value |
|---------|-------|
| **Timezone** | CET (Central European Time) |
| **Daily notification** | 7:30 AM CET |
| **Weekly report** | Sunday 6:00 PM CET |
| **Weekend notifications** | Yes (same as weekdays) |

---

## Non-Functional Requirements

### NFR-1: Template Customization

- Message templates stored in a separate configuration file
- Easy to modify without changing core logic
- Located at: `functions/src/templates/notifications.js`

### NFR-2: No-Code Implementation

- Primary automation via Make.com (no custom code required)
- Optional: Firebase Cloud Functions for advanced logic

### NFR-3: Cost

- Target: Free tier usage only
- Make.com: 1,000 operations/month
- Notion: Free personal plan

---

## Remaining Questions

### RQ-1: Task ID Display ✅ DECIDED

**Decision:** Sequential numbers within the message (e.g., `[1]`, `[2]`, `[3]`)

- Most user-friendly for quick `/done` commands
- Numbers reset with each notification
- Example: `/done 2` to complete the second task in the list

---

### RQ-2: Default Due Date for `/add` ✅ DECIDED

**Decision:** `/add` command defaults to **tomorrow** as the due date

- `/add Buy groceries` → creates task due tomorrow
- `/add Buy groceries today` → creates task due today
- `/add Buy groceries 2026-02-15` → creates task due on specific date

Supported date formats: `today`, `tomorrow`, `YYYY-MM-DD`

---

### RQ-3: Default Priority ✅ DECIDED

**Decision:** **P1** (high priority) when not specified

- Ensures new tasks get attention
- User can explicitly set lower priority if needed: `/add [P3] Low priority task`

---

### RQ-4: Confirmation Messages ✅ DECIDED

**Decision:** Always confirm every Telegram action

Examples:
- `/add Buy groceries` → "✅ Task added: Buy groceries — due tomorrow [P1]"
- `/done 2` → "✅ Marked as done: Buy groceries"
- `/snooze 3` → "✅ Snoozed: Review PR — now due tomorrow"
- `/list` → Shows task list (no additional confirmation needed)

---

### RQ-5: Error Handling ✅ DECIDED

**Decision:** Brief error messages

Examples:
- "❌ Task not found"
- "❌ Invalid command"
- "❌ Missing task title"
- "❌ Invalid date format"

---

## Implementation Phases

### Phase 1: Core Setup
- [ ] Create Notion database with required properties
- [ ] Create Telegram bot via @BotFather
- [ ] Set up Make.com account and connect Notion + Telegram

### Phase 2: Daily Notifications
- [ ] Create Make.com scenario for 7:30 AM notification
- [ ] Implement message template with 4 groups
- [ ] Test with sample data

### Phase 3: Telegram Commands
- [ ] Set up webhook for incoming Telegram messages
- [ ] Implement `/add` command
- [ ] Implement `/list` command
- [ ] Implement `/done` command
- [ ] Implement `/snooze` command

### Phase 4: Weekly Report
- [ ] Create Make.com scenario for Sunday 6:00 PM
- [ ] Implement weekly summary template
- [ ] Add productivity stats calculation

### Phase 5: Polish
- [ ] Error handling and edge cases
- [ ] Template refinement based on usage
- [ ] Documentation

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 0.5 | 2026-02-01 | Added Obsidian sync feature (FR-5) with Go file watcher |
| 0.4 | 2026-02-01 | Added subtasks support (FR-1 update, `/subtask` command) |
| 0.1 | 2026-02-01 | Initial requirements document |
| 0.2 | 2026-02-01 | Resolved RQ-1 (sequential IDs), RQ-2 (tomorrow default), RQ-3 (P1 default) |
| 0.3 | 2026-02-01 | Resolved RQ-4 (always confirm), RQ-5 (brief errors); Added executive summary |
