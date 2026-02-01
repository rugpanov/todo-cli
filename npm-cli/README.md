# todo-cli-tracker

A CLI TODO tracker with Supabase backend.

## Installation

```bash
npm install -g todo-cli-tracker
```

## Configuration

Create `~/.todo-cli.env` or `.env` in your working directory:

```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
TELEGRAM_CHAT_ID=your-user-id
```

## Usage

```bash
# Add a task (due tomorrow, priority P1)
todo add "Buy groceries"

# Add with specific date
todo add "Meeting" today
todo add "Report" 2026-02-15

# Add with priority
todo add "[P2] Review docs" tomorrow

# List all pending tasks
todo list

# Mark task as done
todo done 5

# Postpone task to tomorrow
todo snooze 3

# Add subtask
todo subtask 2 "Review section A"

# Help
todo help
```

## Commands

| Command | Description |
|---------|-------------|
| `add <task> [date]` | Add task (default: due tomorrow, P1) |
| `list` / `ls` | Show all pending tasks |
| `done <id>` | Mark task as complete |
| `snooze <id>` | Postpone to tomorrow |
| `subtask <id> <task>` | Add subtask to existing task |
| `help` | Show help |

## Priority Levels

- `[P0]` — Emergency
- `[P1]` — High (default)
- `[P2]` — Medium
- `[P3]` — Low
- `[P4]` — Someday

## Date Formats

- `today` — Due today
- `tomorrow` — Due tomorrow (default)
- `YYYY-MM-DD` — Specific date

## License

MIT
