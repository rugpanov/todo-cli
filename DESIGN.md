# TODO Tracker — High-Level Design

## System Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              SYSTEM OVERVIEW                                 │
└─────────────────────────────────────────────────────────────────────────────┘

    ┌──────────────┐                                      ┌──────────────┐
    │              │                                      │              │
    │    USER      │◀────────── Notifications ───────────▶│   TELEGRAM   │
    │              │                                      │     BOT      │
    │              │─────────── Commands ────────────────▶│              │
    └──────────────┘                                      └──────┬───────┘
                                                                 │
                                                                 │ Webhook
                                                                 ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              MAKE.COM                                        │
│                                                                              │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────┐          │
│  │  Daily Digest   │  │  Weekly Report  │  │  Command Handler    │          │
│  │  7:30 AM CET    │  │  Sun 6:00 PM    │  │  /add /list /done   │          │
│  │  (Scheduled)    │  │  (Scheduled)    │  │  /snooze /subtask   │          │
│  └────────┬────────┘  └────────┬────────┘  └──────────┬──────────┘          │
│           │                    │                      │                      │
│           └────────────────────┼──────────────────────┘                      │
│                                ▼                                             │
│                       ┌───────────────┐                                      │
│                       │  Supabase API │                                      │
│                       └───────┬───────┘                                      │
└───────────────────────────────┼──────────────────────────────────────────────┘
                                │
                                ▼
                    ┌───────────────────────┐
                    │   SUPABASE (PostgreSQL)│
                    │                        │
                    │  ┌──────────────────┐  │
                    │  │      tasks       │  │
                    │  │  - id            │  │
                    │  │  - title         │  │
                    │  │  - due_date      │  │
                    │  │  - priority      │  │
                    │  │  - status        │  │
                    │  │  - parent_id     │  │
                    │  │  - user_id       │  │
                    │  └──────────────────┘  │
                    └───────────────────────┘
```

---

## Data Flow Diagrams

### 1. Daily Notification Flow

```
┌──────────┐     ┌──────────────┐     ┌────────────┐     ┌──────────┐
│ Scheduler│────▶│   Query      │────▶│  Format    │────▶│ Send to  │
│ 7:30 AM  │     │   Supabase   │     │  Message   │     │ Telegram │
└──────────┘     └──────────────┘     └────────────┘     └──────────┘
                        │
                        ▼
              ┌─────────────────────┐
              │ Group by:           │
              │ • Overdue           │
              │ • Today             │
              │ • Next 2 days       │
              │ • Completed yesterday│
              └─────────────────────┘
```

### 2. Telegram Command Flow

```
┌──────┐     ┌──────────┐     ┌──────────────┐     ┌──────────┐     ┌──────────┐
│ User │────▶│ Telegram │────▶│   Make.com   │────▶│ Supabase │────▶│ Confirm  │
│      │     │   Bot    │     │   Webhook    │     │   API    │     │ to User  │
└──────┘     └──────────┘     └──────────────┘     └──────────┘     └──────────┘
                                    │
                                    ▼
                            ┌───────────────┐
                            │ Parse & Route │
                            │ /add /done    │
                            │ /list /snooze │
                            │ /subtask      │
                            │ /token /revoke│
                            └───────────────┘
```

### 3. Weekly Report Flow

```
┌──────────┐     ┌──────────────┐     ┌────────────────┐     ┌──────────┐
│ Scheduler│────▶│   Query      │────▶│ Calculate Stats│────▶│ Send to  │
│ Sun 6 PM │     │   Supabase   │     │ & Format       │     │ Telegram │
└──────────┘     └──────────────┘     └────────────────┘     └──────────┘
                        │
                        ▼
              ┌─────────────────────┐
              │ Gather:             │
              │ • Completed (7 days)│
              │ • Pending tasks     │
              │ • Completion rate   │
              │ • Upcoming week     │
              └─────────────────────┘
```

### 4. Obsidian Sync Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         TWO-WAY SYNC                                         │
└─────────────────────────────────────────────────────────────────────────────┘

  EXPORT (Supabase → Obsidian):

  ┌──────────┐     ┌──────────────┐     ┌────────────┐     ┌──────────────┐
  │ Make.com │────▶│   Query      │────▶│  Format    │────▶│ Save to      │
  │ Trigger  │     │   Supabase   │     │  Markdown  │     │ Cloud Sync   │
  └──────────┘     └──────────────┘     └────────────┘     └──────┬───────┘
                                                                  │
                                                                  ▼
                                                         ┌──────────────┐
                                                         │   Obsidian   │
                                                         │   Vault      │
                                                         │  (todo.md)   │
                                                         └──────┬───────┘
                                                                  │
  IMPORT (Obsidian → Supabase):                                   │
                                                                  ▼
  ┌──────────────┐     ┌──────────────┐     ┌────────────┐     ┌──────────┐
  │   Obsidian   │────▶│  Go Watcher  │────▶│   Parse    │────▶│ Supabase │
  │   (edit)     │     │  (fsnotify)  │     │   & Diff   │     │   API    │
  └──────────────┘     └──────────────┘     └────────────┘     └──────────┘
                              │
                              ▼
                    ┌─────────────────────┐
                    │ • Watch todo.md     │
                    │ • Debounce 1-2 sec  │
                    │ • Parse checkboxes  │
                    │ • Sync changes      │
                    └─────────────────────┘
```

### 5. CLI Token Authentication Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                      TOKEN GENERATION (one-time)                             │
└─────────────────────────────────────────────────────────────────────────────┘

  ┌──────┐     ┌──────────┐     ┌──────────────┐     ┌──────────┐
  │ User │────▶│ /token   │────▶│  Generate    │────▶│  Store   │
  │      │     │ command  │     │  UUID token  │     │  hash    │
  └──────┘     └──────────┘     └──────────────┘     └────┬─────┘
                                       │                   │
                                       ▼                   ▼
                              ┌──────────────┐    ┌──────────────┐
                              │ Send token   │    │ api_tokens   │
                              │ to user once │    │ table        │
                              └──────────────┘    └──────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│                      CLI AUTHENTICATION (each request)                       │
└─────────────────────────────────────────────────────────────────────────────┘

  ┌──────┐     ┌──────────────┐     ┌──────────────┐     ┌──────────┐
  │ CLI  │────▶│ Read token   │────▶│ auth-verify  │────▶│ Hash &   │
  │      │     │ from file    │     │ edge func    │     │ lookup   │
  └──────┘     └──────────────┘     └──────────────┘     └────┬─────┘
                                                              │
                    ┌─────────────────────────────────────────┘
                    ▼
           ┌──────────────┐     ┌──────────────┐     ┌──────────┐
           │ Return       │────▶│ CLI uses     │────▶│ Supabase │
           │ user_id      │     │ user_id      │     │ API      │
           └──────────────┘     └──────────────┘     └──────────┘
```

---

## Database Schema

```
┌─────────────────────────────────────────────────────────────┐
│                         tasks                                │
├─────────────────────────────────────────────────────────────┤
│  id          SERIAL PRIMARY KEY                             │
│  title       TEXT NOT NULL                                  │
│  due_date    DATE DEFAULT CURRENT_DATE + 1                  │
│  priority    TEXT DEFAULT 'P1' (P0, P1, P2, P3, P4)         │
│  status      TEXT DEFAULT 'Todo' (Todo, Done)               │
│  parent_id   INTEGER REFERENCES tasks(id)                   │
│  user_id     TEXT NOT NULL (Telegram Chat ID)               │
│  created_at  TIMESTAMPTZ DEFAULT NOW()                      │
└─────────────────────────────────────────────────────────────┘

Subtask Relationship:
┌────────────┐          ┌────────────┐
│ Parent Task│◀─────────│  Subtask   │
│ (id: 1)    │ parent_id│  (id: 2)   │
└────────────┘          └────────────┘

┌─────────────────────────────────────────────────────────────┐
│                       api_tokens                             │
├─────────────────────────────────────────────────────────────┤
│  id          SERIAL PRIMARY KEY                             │
│  user_id     TEXT NOT NULL (Telegram Chat ID)               │
│  token_hash  TEXT NOT NULL UNIQUE (SHA-256)                 │
│  name        TEXT DEFAULT 'CLI Token'                       │
│  created_at  TIMESTAMPTZ DEFAULT NOW()                      │
│  expires_at  TIMESTAMPTZ DEFAULT NOW() + 1 year             │
└─────────────────────────────────────────────────────────────┘
```

---

## Implementation Phases

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  Phase 1        │     │  Phase 2        │     │  Phase 3        │
│  Core Setup     │────▶│  Daily Digest   │────▶│  Commands       │
│                 │     │                 │     │                 │
│ • Supabase DB   │     │ • 7:30 AM job   │     │ • Webhook       │
│ • Telegram bot  │     │ • Message format│     │ • /add /list    │
│ • Make.com      │     │ • Task grouping │     │ • /done /snooze │
└─────────────────┘     └─────────────────┘     └────────┬────────┘
                                                         │
                                                         ▼
                        ┌─────────────────┐     ┌─────────────────┐
                        │  Phase 5        │     │  Phase 4        │
                        │  Polish         │◀────│  Weekly Report  │
                        │                 │     │                 │
                        │ • Error handling│     │ • Sunday job    │
                        │ • Edge cases    │     │ • Stats calc    │
                        │ • Documentation │     │ • Summary format│
                        └─────────────────┘     └─────────────────┘
```
