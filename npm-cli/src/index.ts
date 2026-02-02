#!/usr/bin/env node

import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';

// Load .env file
function loadEnv(): void {
  const envPaths = [
    path.join(process.cwd(), '.env'),
    path.join(process.env.HOME || '', '.todo-cli.env'),
  ];
  
  for (const envPath of envPaths) {
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, 'utf-8');
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#')) {
          const [key, ...valueParts] = trimmed.split('=');
          const value = valueParts.join('=');
          if (key && value && !process.env[key]) {
            process.env[key] = value;
          }
        }
      }
      break;
    }
  }
}

loadEnv();

const DEFAULT_SUPABASE_URL = 'https://awpmhcblqvvliarpcawk.supabase.co';
const DEFAULT_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF3cG1oY2JscXZ2bGlhcnBjYXdrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk5NTMyNjksImV4cCI6MjA4NTUyOTI2OX0.Q3LlZDciuP1Gm-elhl8-FlxCjNi4NlZ9M8PxAqNf1-8';

let SUPABASE_URL = process.env.TODO_CLI_SUPABASE_URL || process.env.SUPABASE_URL || DEFAULT_SUPABASE_URL;
let SUPABASE_KEY = '';
let USER_ID = '';
let API_TOKEN = '';

// Try to load API token
function loadApiToken(): string {
  // Check env var first (TODO_CLI_ prefix takes priority)
  if (process.env.TODO_CLI_TOKEN) {
    return process.env.TODO_CLI_TOKEN;
  }
  if (process.env.TODO_CLI_API_TOKEN) {
    return process.env.TODO_CLI_API_TOKEN;
  }
  // Try ~/.todo-cli-token
  const tokenPath = path.join(process.env.HOME || '', '.todo-cli-token');
  if (fs.existsSync(tokenPath)) {
    return fs.readFileSync(tokenPath, 'utf-8').trim();
  }
  return '';
}

async function verifyToken(token: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = new URL(`${SUPABASE_URL}/functions/v1/auth-verify`);
    
    const options = {
      hostname: url.hostname,
      path: url.pathname,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        if (res.statusCode === 200) {
          const result = JSON.parse(data);
          resolve(result.user_id);
        } else {
          const err = JSON.parse(data);
          reject(new Error(err.error || 'Invalid token'));
        }
      });
    });

    req.on('error', reject);
    req.end();
  });
}

async function initAuth(): Promise<void> {
  API_TOKEN = loadApiToken();
  
  if (API_TOKEN) {
    try {
      USER_ID = await verifyToken(API_TOKEN);
      SUPABASE_KEY = process.env.TODO_CLI_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || DEFAULT_ANON_KEY;
    } catch (err: any) {
      console.error(`❌ Invalid API token: ${err.message}`);
      process.exit(1);
    }
  } else {
    // Fall back to service role key (legacy mode)
    SUPABASE_KEY = process.env.TODO_CLI_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
    USER_ID = process.env.TODO_CLI_TELEGRAM_CHAT_ID || process.env.TELEGRAM_CHAT_ID || 'cli';
    
    if (!SUPABASE_KEY) {
      console.error('❌ No API token found. Generate one with /token in Telegram bot.');
      console.error('   Save token to ~/.todo-cli-token or set TODO_CLI_TOKEN env var.');
      process.exit(1);
    }
  }
}

interface Task {
  id: number;
  title: string;
  due_date: string;
  priority: string;
  status: string;
  parent_id: number | null;
  user_id: string;
  created_at: string;
}

// ANSI colors
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const GREEN = '\x1b[32m';
const RESET = '\x1b[0m';

function request(method: string, endpoint: string, body?: object): Promise<any> {
  return new Promise((resolve, reject) => {
    const url = new URL(`${SUPABASE_URL}/rest/v1/${endpoint}`);
    
    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method,
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation',
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          resolve(data ? JSON.parse(data) : null);
        } catch {
          resolve(data);
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function formatDate(date: Date): string {
  return date.toISOString().split('T')[0];
}

function parseArgs(args: string[]): { title: string; priority: string; dueDate: string } {
  let title = args.join(' ');
  let priority = 'P1';
  const today = new Date();
  let dueDate = formatDate(new Date(today.setDate(today.getDate() + 1)));

  // Parse priority [P0-P4]
  const prioMatch = title.match(/\[P([0-4])\]/);
  if (prioMatch) {
    priority = 'P' + prioMatch[1];
    title = title.replace(/\[P[0-4]\]/, '').trim();
  }

  // Parse date
  const words = title.split(' ');
  if (words.length > 1) {
    const lastWord = words[words.length - 1];
    if (lastWord === 'today') {
      dueDate = formatDate(new Date());
      title = words.slice(0, -1).join(' ');
    } else if (lastWord === 'tomorrow') {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      dueDate = formatDate(tomorrow);
      title = words.slice(0, -1).join(' ');
    } else if (/^\d{4}-\d{2}-\d{2}$/.test(lastWord)) {
      dueDate = lastWord;
      title = words.slice(0, -1).join(' ');
    }
  }

  return { title, priority, dueDate };
}

async function cmdAdd(args: string[]): Promise<void> {
  if (args.length === 0) {
    console.log('❌ Missing task title. Usage: todo add <task>');
    process.exit(1);
  }

  const { title, priority, dueDate } = parseArgs(args);

  const result = await request('POST', 'tasks', {
    title,
    due_date: dueDate,
    priority,
    status: 'Todo',
    user_id: USER_ID,
  });

  if (Array.isArray(result) && result.length > 0) {
    const task = result[0];
    console.log(`✅ Task added: ${task.title} — due ${task.due_date} [${task.priority}]`);
  } else {
    console.log('❌ Failed to add task');
  }
}

async function cmdList(): Promise<void> {
  const today = formatDate(new Date());
  const tasks = await request(
    'GET',
    `tasks?user_id=eq.${USER_ID}&status=eq.Todo&order=priority,due_date`
  );

  if (!Array.isArray(tasks)) {
    console.log('❌ Failed to fetch tasks');
    return;
  }

  if (tasks.length === 0) {
    console.log('🎉 No pending tasks!');
    return;
  }

  console.log('📋 All pending tasks:\n');
  for (const task of tasks.slice(0, 15) as Task[]) {
    let color = RESET;
    let suffix = '';
    
    if (task.due_date < today) {
      color = RED;
      suffix = ' ⚠️ overdue';
    } else if (task.due_date === today) {
      color = YELLOW;
      suffix = ' (today)';
    } else {
      suffix = ` — due ${task.due_date}`;
    }

    console.log(`${color}[id:${task.id}] [${task.priority}] ${task.title}${suffix}${RESET}`);
  }

  if (tasks.length > 15) {
    console.log(`...and ${tasks.length - 15} more`);
  }
}

async function cmdDone(args: string[]): Promise<void> {
  if (args.length === 0) {
    console.log('❌ Missing task ID. Usage: todo done <id>');
    process.exit(1);
  }

  const id = parseInt(args[0], 10);
  if (isNaN(id)) {
    console.log('❌ Invalid task ID');
    process.exit(1);
  }

  const result = await request('PATCH', `tasks?id=eq.${id}&user_id=eq.${USER_ID}`, {
    status: 'Done',
  });

  if (Array.isArray(result) && result.length > 0) {
    console.log(`✅ Marked as done: ${result[0].title}`);
  } else {
    console.log('❌ Task not found');
  }
}

async function cmdSnooze(args: string[]): Promise<void> {
  if (args.length === 0) {
    console.log('❌ Missing task ID. Usage: todo snooze <id>');
    process.exit(1);
  }

  const id = parseInt(args[0], 10);
  if (isNaN(id)) {
    console.log('❌ Invalid task ID');
    process.exit(1);
  }

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);

  const result = await request('PATCH', `tasks?id=eq.${id}&user_id=eq.${USER_ID}`, {
    due_date: formatDate(tomorrow),
  });

  if (Array.isArray(result) && result.length > 0) {
    console.log(`✅ Snoozed: ${result[0].title} — now due ${result[0].due_date}`);
  } else {
    console.log('❌ Task not found');
  }
}

async function cmdSubtask(args: string[]): Promise<void> {
  if (args.length < 2) {
    console.log('❌ Usage: todo subtask <parent_id> <task>');
    process.exit(1);
  }

  const parentId = parseInt(args[0], 10);
  if (isNaN(parentId)) {
    console.log('❌ Invalid parent ID');
    process.exit(1);
  }

  // Get parent task
  const parents: Task[] = await request(
    'GET',
    `tasks?id=eq.${parentId}&user_id=eq.${USER_ID}`
  );

  if (!parents || parents.length === 0) {
    console.log('❌ Parent task not found');
    process.exit(1);
  }

  const parent = parents[0];
  const { title, priority, dueDate } = parseArgs(args.slice(1));

  const result = await request('POST', 'tasks', {
    title,
    due_date: dueDate || parent.due_date,
    priority: priority || parent.priority,
    status: 'Todo',
    parent_id: parentId,
    user_id: USER_ID,
  });

  if (Array.isArray(result) && result.length > 0) {
    console.log(`✅ Subtask added to "${parent.title}": ${result[0].title}`);
  } else {
    console.log('❌ Failed to add subtask');
  }
}

function printHelp(): void {
  console.log(`TODO Tracker CLI

Usage: todo <command> [arguments]

Commands:
  add <task> [date]      Add a new task (default: due tomorrow, P1)
                         Examples:
                           todo add "Buy groceries"
                           todo add "Meeting" today
                           todo add "[P2] Report" 2026-02-15

  list, ls               Show all pending tasks

  done, rm <id>          Mark task as complete
                         Example: todo done 5

  snooze <id>            Postpone task to tomorrow
                         Example: todo snooze 3

  subtask <id> <task>    Add subtask to existing task
                         Example: todo subtask 2 "Review section"

  help                   Show this help message

Authentication:
  1. Generate token: Send /token to the Telegram bot
  2. Save token to ~/.todo-cli-token or set TODO_CLI_TOKEN env var

  Legacy mode (service role key):
    Create .env file or ~/.todo-cli.env with:
      SUPABASE_URL=https://your-project.supabase.co
      SUPABASE_SERVICE_ROLE_KEY=your-key
      TELEGRAM_CHAT_ID=your-user-id`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  
  // Show help without auth
  if (args.length === 0 || args[0] === 'help' || args[0] === '--help' || args[0] === '-h') {
    printHelp();
    return;
  }

  // Initialize auth before running commands
  await initAuth();

  const cmd = args[0];
  const cmdArgs = args.slice(1);

  try {
    switch (cmd) {
      case 'add':
        await cmdAdd(cmdArgs);
        break;
      case 'list':
      case 'ls':
        await cmdList();
        break;
      case 'done':
      case 'rm':
        await cmdDone(cmdArgs);
        break;
      case 'snooze':
        await cmdSnooze(cmdArgs);
        break;
      case 'subtask':
        await cmdSubtask(cmdArgs);
        break;
      case 'help':
      case '--help':
      case '-h':
        printHelp();
        break;
      default:
        console.log(`❌ Unknown command: ${cmd}`);
        printHelp();
        process.exit(1);
    }
  } catch (error) {
    console.log(`❌ Error: ${error}`);
    process.exit(1);
  }
}

main();
