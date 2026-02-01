# TODO Tracker

A TODO tracker with multiple interfaces: Telegram bot, CLI, and Obsidian sync.

## Features

- **Telegram Bot:** `/add`, `/list`, `/done`, `/snooze`, `/subtask`, `/token`, `/revoke`
- **CLI Tool:** `todo add`, `todo list`, `todo done`, etc.
- **Obsidian Sync:** Two-way sync with markdown files
- **Daily Digest:** 7:30 AM CET — overdue, today, next 2 days, completed yesterday
- **Weekly Report:** Sunday 6:00 PM CET — stats and upcoming tasks
- **Subtasks:** Any task can have subtasks

## Quick Start

### Option 1: Telegram Bot

```
/start              - Welcome message
/add Buy groceries  - Add task (due tomorrow, P1)
/add [P2] Call mom tomorrow
/list               - Show all pending tasks
/done 2             - Mark task #2 as done
/snooze 3           - Postpone task #3 to tomorrow
/subtask 2 Buy milk - Add subtask to task #2
/token laptop     - Generate API token for CLI
/revoke           - List your API tokens
/revoke 5         - Revoke token #5
```

### Option 2: CLI Tool

```bash
# 1. Generate API token (in Telegram)
#    Send /token to the bot, save the token

# 2. Save token
echo "your-token-here" > ~/.todo-cli-token

# 3. Build and use
go build -o todo ./cmd/todo/

# Usage
./todo add "Buy groceries"           # Add task (due tomorrow, P1)
./todo add "[P2] Call mom" today     # Add with priority and date
./todo list                          # Show all pending tasks
./todo done 5                        # Mark task #5 complete
./todo snooze 3                      # Postpone to tomorrow
./todo subtask 2 "Buy milk"          # Add subtask
./todo help                          # Show help
```

### Option 3: Obsidian Sync

```bash
# Build
go build -o obsidian-sync ./cmd/obsidian-sync/

# Set your todo file path
export TODO_CLI_FILE=~/Documents/todo/todo.md

# Export tasks to markdown
./obsidian-sync export

# Watch for changes (checkbox edits sync back)
./obsidian-sync watch
```

### Trigger Reports Manually

```bash
# Daily digest
curl "https://awpmhcblqvvliarpcawk.supabase.co/functions/v1/daily-digest" \
  -H "Authorization: Bearer <ANON_KEY>"

# Weekly report
curl "https://awpmhcblqvvliarpcawk.supabase.co/functions/v1/weekly-report" \
  -H "Authorization: Bearer <ANON_KEY>"
```

## Architecture

```
User ↔ Telegram Bot ↔ Supabase Edge Functions ↔ PostgreSQL
                              ↓
                         pg_cron (scheduled tasks)
```

## Project Structure

```
todo-tracker/
├── supabase/
│   ├── functions/
│   │   ├── telegram-webhook/   # Command handler
│   │   ├── daily-digest/       # Morning notification
│   │   ├── weekly-report/      # Sunday summary
│   │   └── auth-verify/        # Token authentication
│   └── migrations/             # Database schema
├── cmd/
│   ├── todo/                   # CLI tool
│   ├── obsidian-sync/          # Obsidian two-way sync
│   └── webhook/                # Go webhook (alternative)
├── .env                        # Secrets (not committed)
├── requirements.md             # Full requirements
├── DESIGN.md                   # Architecture diagrams
└── steps.md                    # Development checklist
```

## Authentication

### For CLI Users (Recommended)

1. Send `/token` to the Telegram bot
2. Save the token: `echo "your-token" > ~/.todo-cli-token`
3. CLI will automatically authenticate using this token

Alternatively, set `TODO_CLI_TOKEN` environment variable.

### For Developers (Legacy)

Required secrets (set via `supabase secrets set`):
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`

Auto-available in edge functions:
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

## Deployment

```bash
# Deploy all functions
supabase functions deploy telegram-webhook --no-verify-jwt
supabase functions deploy daily-digest --no-verify-jwt
supabase functions deploy weekly-report --no-verify-jwt
supabase functions deploy auth-verify --no-verify-jwt

# Set secrets
supabase secrets set TELEGRAM_BOT_TOKEN=<token>
supabase secrets set TELEGRAM_CHAT_ID=<chat_id>
```

## Cron Schedules

Daily digest is scheduled via pg_cron. For weekly report, run in SQL Editor:

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

## Database Schema

```sql
-- Tasks table
CREATE TABLE tasks (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  due_date DATE DEFAULT CURRENT_DATE + 1,
  priority TEXT DEFAULT 'P1',
  status TEXT DEFAULT 'Todo',
  parent_id INTEGER REFERENCES tasks(id),
  user_id TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- API tokens for CLI authentication
CREATE TABLE api_tokens (
  id SERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  name TEXT DEFAULT 'CLI Token',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ DEFAULT NOW() + INTERVAL '1 year'
);
```
