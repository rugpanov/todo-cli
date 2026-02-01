# TODO Tracker — Development Steps

## Phase 1: Core Setup

### 1.1 Supabase Setup (CLI)

**Prerequisites:**
```bash
brew install supabase/tap/supabase
```

**Steps:**
```bash
# 1. Login (opens browser once)
supabase login

# 2. Get your organization ID
supabase orgs list

# 3. Create project
supabase projects create todo-tracker \
  --org-id <your-org-id> \
  --db-password <secure-password> \
  --region eu-central-1

# 4. Get project reference and API keys
supabase projects list
supabase projects api-keys --project-ref <project-ref>

# 5. Link local directory to project
supabase init
supabase link --project-ref <project-ref>
```

**Save these values:**
- Project URL: `https://<project-ref>.supabase.co`
- Anon Key: from `api-keys` output
- Service Role Key: from `api-keys` output

---

### 1.2 Database Schema (CLI)

**Create migration:**
```bash
supabase migration new create_tasks_table
```

**Edit migration file** (`supabase/migrations/<timestamp>_create_tasks_table.sql`):
```sql
CREATE TABLE tasks (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  due_date DATE DEFAULT CURRENT_DATE + 1,
  priority TEXT DEFAULT 'P1' CHECK (priority IN ('P0','P1','P2','P3','P4')),
  status TEXT DEFAULT 'Todo' CHECK (status IN ('Todo','Done')),
  parent_id INTEGER REFERENCES tasks(id),
  user_id TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_tasks_user_id ON tasks(user_id);
CREATE INDEX idx_tasks_due_date ON tasks(due_date);
CREATE INDEX idx_tasks_status ON tasks(status);
```

**Apply migration:**
```bash
supabase db push
```

**Verify (optional):**
```bash
# Connect to remote database
supabase db remote commit

# Or test via psql
psql "$(supabase db url)" -c "\dt"
```

### 1.3 Telegram Bot
- [ ] Message @BotFather on Telegram
- [ ] Send `/newbot`, follow prompts
- [ ] Save bot token
- [ ] Set bot commands via `/setcommands`:
```
add - Add new task
list - Show today's tasks
done - Mark task complete
snooze - Push task to tomorrow
subtask - Add subtask to existing task
```

---

## Phase 2: Make.com Foundation

### 2.1 ~~Make.com~~ → Supabase Edge Functions
- [x] Pivoted from Make.com to Supabase Edge Functions (free, CLI-deployable)
- [x] Created `telegram-webhook` edge function
- [x] Deployed via `supabase functions deploy`

### 2.2 Secrets Configuration
- [x] Set `TELEGRAM_BOT_TOKEN` via `supabase secrets set`
- [x] `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` auto-available in edge functions

### 2.3 Webhook Setup
- [x] Telegram webhook set to: `https://awpmhcblqvvliarpcawk.supabase.co/functions/v1/telegram-webhook`
- [x] Verified webhook active via `getWebhookInfo`
- [x] Commands implemented: `/start`, `/add`, `/list`, `/done`, `/snooze`, `/subtask`

---

## Phase 3: Daily Digest ✅

- [x] Created `daily-digest` edge function
- [x] Deployed to Supabase
- [x] Cron scheduled: 7:30 AM CET (6:30 UTC) via pg_cron
- [x] Tested successfully

---

## Phase 4: Commands ✅

All commands implemented in `telegram-webhook` edge function:
- [x] `/start` - Welcome message
- [x] `/add` - Add task with priority/date parsing
- [x] `/list` - Show today's tasks
- [x] `/done` - Mark task complete
- [x] `/snooze` - Postpone to tomorrow
- [x] `/subtask` - Add subtask to parent

---

## Phase 5: Weekly Report ✅

- [x] Created `weekly-report` edge function
- [x] Deployed to Supabase
- [x] Tested successfully
- [ ] Cron schedule: Run this SQL in Supabase Dashboard → SQL Editor:
```sql
SELECT cron.schedule(
  'weekly-report',
  '0 17 * * 0',
  $$
  SELECT net.http_post(
    url := 'https://awpmhcblqvvliarpcawk.supabase.co/functions/v1/weekly-report',
    headers := '{}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);
```

---

## Phase 6: CLI Tool ✅

### 6.1 Go CLI Implementation
- [x] Create CLI directory: `mkdir -p cmd/todo`
- [x] Implement commands:
```bash
todo add "Buy groceries"           # Add task (due tomorrow, P1)
todo add "Meeting" today            # Add task due today
todo add "[P2] Report" 2026-02-15   # Add with priority and date
todo list                           # Show all pending tasks
todo done 5                         # Mark task #5 complete
todo snooze 3                       # Postpone task #3 to tomorrow
todo subtask 2 "Review section"     # Add subtask to task #2
```
- [x] Load config from `.env` or environment variables
- [x] Use Supabase REST API for database operations
- [x] Build binary: `go build -o todo ./cmd/todo`
- [ ] Install: `cp todo /usr/local/bin/` or add to PATH

### 6.2 CLI Features
- [x] Colored output (overdue in red, today in yellow)
- [x] `--help` for each command
- [ ] `todo config` to set/view Supabase credentials (optional)

---

## Phase 7: Obsidian Sync (Optional) ✅

### 7.1 Export (Supabase → Obsidian)
- [x] `obsidian-sync export` command
- [x] Groups tasks by: Overdue, Today, Upcoming
- [x] Markdown format with hidden ID comments
- [x] Configurable via `OBSIDIAN_TODO_FILE` env var

### 7.2 Watch Mode (Obsidian → Supabase)
- [x] `obsidian-sync watch` command
- [x] Uses fsnotify for file watching
- [x] Parses checkbox changes `- [ ]` / `- [x]`
- [x] Syncs status changes back to Supabase
- [x] 2-second debounce

### 7.3 Usage
```bash
# Set path to your Obsidian todo file
export OBSIDIAN_TODO_FILE=~/Documents/Obsidian/todo.md

# Export tasks to markdown
./obsidian-sync export

# Watch for changes (run in background)
./obsidian-sync watch &
```

---

## Phase 8: Testing & Polish ✅

### 8.1 Testing Checklist
- [x] **Telegram Commands:**
  - [x] `/add` creates task with defaults
  - [x] `/add [P2] task tomorrow` works
  - [x] `/list` shows all pending tasks
  - [x] `/done <id>` marks correct task
  - [x] `/snooze <id>` updates due date
  - [x] `/subtask <id> title` creates subtask
- [x] **CLI Tool:**
  - [x] `todo add` creates task
  - [x] `todo list` shows tasks with colors
  - [x] `todo done` marks complete
  - [x] `todo snooze` postpones
  - [x] `todo subtask` creates subtask
- [x] **Obsidian Sync:**
  - [x] Export creates valid Markdown
  - [x] Hidden ID comments for sync
- [ ] **Scheduled Reports:** (manual verification needed)
  - [ ] Daily Digest fires at 7:30 AM CET
  - [ ] Weekly Report fires Sunday 6 PM CET

### 8.2 Error Handling
- [x] Invalid command format → "❌ Unknown command"
- [x] Task not found → "❌ Task not found"
- [x] Missing task title → "❌ Missing task title"
- [x] Invalid date format → uses default (tomorrow)

### 8.3 Documentation
- [x] README with all interfaces (Telegram, CLI, Obsidian)
- [x] requirements.md with full specs
- [x] DESIGN.md with architecture diagrams
- [x] steps.md development checklist

---

## Quick Reference

| Phase | Estimated Time | Dependencies |
|-------|---------------|--------------|
| 1. Core Setup | 30 min | None |
| 2. Make.com Foundation | 20 min | Phase 1 |
| 3. Daily Digest | 45 min | Phase 2 |
| 4. Command Handler | 60 min | Phase 2 |
| 5. Weekly Report | 30 min | Phase 2 |
| 6. CLI Tool | 60 min | Phase 1 |
| 7. Obsidian Sync | 90 min | Phase 2 |
| 8. Testing & Polish | 60 min | All |

**Total: ~6.5 hours**
