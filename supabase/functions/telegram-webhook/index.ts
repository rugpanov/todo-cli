import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

// Helper to convert ArrayBuffer to hex string
function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

const supabaseUrl = Deno.env.get("SUPABASE_URL")!
const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN")!

const supabase = createClient(supabaseUrl, supabaseKey)

serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("OK", { status: 200 })
  }

  const update = await req.json()
  const message = update.message
  if (!message?.text) {
    return new Response("OK", { status: 200 })
  }

  const chatId = message.chat.id
  let text = message.text

  // Normalize: support commands without leading slash
  const firstWord = text.split(" ")[0].toLowerCase()
  const commandWords = ["add", "list", "ls", "done", "rm", "snooze", "subtask", "token", "revoke", "start"]
  if (!firstWord.startsWith("/") && commandWords.includes(firstWord)) {
    text = "/" + text
  }

  let response: string

  if (text.startsWith("/add") || text.toLowerCase().startsWith("/add")) {
    response = await handleAdd(chatId, text)
  } else if (text.startsWith("/list") || text.startsWith("/ls") || text.toLowerCase() === "/ls") {
    response = await handleList(chatId)
  } else if (text.startsWith("/done") || text.startsWith("/rm")) {
    response = await handleDone(chatId, text.replace(/^\/rm/i, "/done"))
  } else if (text.startsWith("/snooze")) {
    response = await handleSnooze(chatId, text)
  } else if (text.startsWith("/subtask")) {
    response = await handleSubtask(chatId, text)
  } else if (text.startsWith("/token")) {
    response = await handleToken(chatId, text)
  } else if (text.startsWith("/revoke")) {
    response = await handleRevoke(chatId, text)
  } else if (text.startsWith("/start")) {
    response = "👋 Welcome to TODO Tracker!\n\nCommands:\nadd <task> - Add task\nlist, ls - Show tasks\ndone, rm <id> - Complete task\nsnooze <id> - Postpone to tomorrow\nsubtask <id> <task> - Add subtask\ntoken [name] - Generate API token for CLI\nrevoke [id] - List or revoke API tokens\n\n(Slash prefix is optional)"
  } else {
    response = "❌ Unknown command. Use add, list (ls), done (rm), snooze, subtask, token, or revoke"
  }

  await sendTelegram(chatId, response)
  return new Response("OK", { status: 200 })
})

async function handleAdd(chatId: number, text: string): Promise<string> {
  text = text.replace("/add", "").trim()
  if (!text) return "❌ Missing task title. Usage: /add <task>"

  let priority = "P1"
  const today = new Date()
  let dueDate = new Date(today.setDate(today.getDate() + 1)).toISOString().split("T")[0]

  // Parse priority [P0-P4]
  const prioMatch = text.match(/\[P([0-4])\]/)
  if (prioMatch) {
    priority = "P" + prioMatch[1]
    text = text.replace(/\[P[0-4]\]/, "").trim()
  }

  // Parse date
  const words = text.split(" ")
  if (words.length > 1) {
    const lastWord = words[words.length - 1]
    if (lastWord === "today") {
      dueDate = new Date().toISOString().split("T")[0]
      text = words.slice(0, -1).join(" ")
    } else if (lastWord === "tomorrow") {
      const tomorrow = new Date()
      tomorrow.setDate(tomorrow.getDate() + 1)
      dueDate = tomorrow.toISOString().split("T")[0]
      text = words.slice(0, -1).join(" ")
    } else if (/^\d{4}-\d{2}-\d{2}$/.test(lastWord)) {
      dueDate = lastWord
      text = words.slice(0, -1).join(" ")
    }
  }

  const { data, error } = await supabase
    .from("tasks")
    .insert({ title: text, due_date: dueDate, priority, status: "Todo", user_id: String(chatId) })
    .select()
    .single()

  if (error) return "❌ Failed to add task: " + error.message
  return `✅ Task added: ${data.title} — due ${data.due_date} [${data.priority}]`
}

async function handleList(chatId: number): Promise<string> {
  const today = new Date().toISOString().split("T")[0]

  const { data: tasks, error } = await supabase
    .from("tasks")
    .select("*")
    .eq("user_id", String(chatId))
    .eq("status", "Todo")
    .order("priority")
    .order("due_date")

  if (error) return "❌ Failed to fetch tasks: " + error.message
  if (!tasks || tasks.length === 0) return "🎉 No pending tasks!"

  let result = "📋 All pending tasks:\n\n"
  for (let i = 0; i < Math.min(tasks.length, 15); i++) {
    const t = tasks[i]
    const overdue = t.due_date < today ? " ⚠️ overdue" : ""
    const dueInfo = t.due_date === today ? " (today)" : ` — due ${t.due_date}`
    result += `[id:${t.id}] [${t.priority}] ${t.title}${dueInfo}${overdue}\n`
  }
  if (tasks.length > 15) {
    result += `...and ${tasks.length - 15} more\n`
  }
  return result
}

async function handleDone(chatId: number, text: string): Promise<string> {
  const id = parseInt(text.replace("/done", "").trim())
  if (isNaN(id)) return "❌ Invalid task ID. Usage: /done <id>"

  const { data: task } = await supabase
    .from("tasks")
    .select("title")
    .eq("id", id)
    .eq("user_id", String(chatId))
    .single()

  if (!task) return "❌ Task not found"

  const { error } = await supabase
    .from("tasks")
    .update({ status: "Done" })
    .eq("id", id)
    .eq("user_id", String(chatId))

  if (error) return "❌ Failed to update task"
  return `✅ Marked as done: ${task.title}`
}

async function handleSnooze(chatId: number, text: string): Promise<string> {
  const id = parseInt(text.replace("/snooze", "").trim())
  if (isNaN(id)) return "❌ Invalid task ID. Usage: /snooze <id>"

  const { data: task } = await supabase
    .from("tasks")
    .select("title")
    .eq("id", id)
    .eq("user_id", String(chatId))
    .single()

  if (!task) return "❌ Task not found"

  const tomorrow = new Date()
  tomorrow.setDate(tomorrow.getDate() + 1)
  const dueDate = tomorrow.toISOString().split("T")[0]

  const { error } = await supabase
    .from("tasks")
    .update({ due_date: dueDate })
    .eq("id", id)
    .eq("user_id", String(chatId))

  if (error) return "❌ Failed to snooze task"
  return `✅ Snoozed: ${task.title} — now due tomorrow`
}

async function handleSubtask(chatId: number, text: string): Promise<string> {
  text = text.replace("/subtask", "").trim()
  const parts = text.split(" ")
  if (parts.length < 2) return "❌ Usage: /subtask <parent_id> <task title>"

  const parentId = parseInt(parts[0])
  if (isNaN(parentId)) return "❌ Invalid parent ID"

  const { data: parent } = await supabase
    .from("tasks")
    .select("*")
    .eq("id", parentId)
    .eq("user_id", String(chatId))
    .single()

  if (!parent) return "❌ Parent task not found"

  const title = parts.slice(1).join(" ")
  const { error } = await supabase
    .from("tasks")
    .insert({
      title,
      due_date: parent.due_date,
      priority: parent.priority,
      status: "Todo",
      parent_id: parentId,
      user_id: String(chatId),
    })

  if (error) return "❌ Failed to add subtask"
  return `✅ Subtask added to '${parent.title}': ${title}`
}

async function handleToken(chatId: number, text: string): Promise<string> {
  const name = text.replace("/token", "").trim() || "CLI Token"
  
  // Generate random token
  const token = crypto.randomUUID() + "-" + crypto.randomUUID()
  
  // Hash the token for storage
  const encoder = new TextEncoder()
  const data = encoder.encode(token)
  const hashBuffer = await crypto.subtle.digest("SHA-256", data)
  const tokenHash = toHex(hashBuffer)
  
  // Store in database
  const { error } = await supabase
    .from("api_tokens")
    .insert({
      user_id: String(chatId),
      token_hash: tokenHash,
      name: name,
    })
  
  if (error) return "❌ Failed to create token: " + error.message
  
  return `🔑 API Token created: ${name}\n\n` +
    `Token: \`${token}\`\n\n` +
    `⚠️ Save this token now! It won't be shown again.\n\n` +
    `Use in CLI: Add to ~/.todo-cli-token or set TODO_CLI_TOKEN env var.`
}

async function handleRevoke(chatId: number, text: string): Promise<string> {
  const idStr = text.replace("/revoke", "").trim()
  
  // If no ID provided, list all tokens
  if (!idStr) {
    const { data: tokens, error } = await supabase
      .from("api_tokens")
      .select("id, name, created_at, expires_at")
      .eq("user_id", String(chatId))
      .order("created_at", { ascending: false })
    
    if (error) return "❌ Failed to fetch tokens: " + error.message
    if (!tokens || tokens.length === 0) return "No API tokens found. Use /token to create one."
    
    let result = "🔑 Your API tokens:\n\n"
    for (const t of tokens) {
      const created = new Date(t.created_at).toISOString().split("T")[0]
      const expires = new Date(t.expires_at).toISOString().split("T")[0]
      result += `[id:${t.id}] ${t.name}\n  Created: ${created}, Expires: ${expires}\n\n`
    }
    result += "To revoke: /revoke <id>"
    return result
  }
  
  // Revoke specific token
  const id = parseInt(idStr)
  if (isNaN(id)) return "❌ Invalid token ID. Usage: /revoke <id>"
  
  const { data: token } = await supabase
    .from("api_tokens")
    .select("name")
    .eq("id", id)
    .eq("user_id", String(chatId))
    .single()
  
  if (!token) return "❌ Token not found"
  
  const { error } = await supabase
    .from("api_tokens")
    .delete()
    .eq("id", id)
    .eq("user_id", String(chatId))
  
  if (error) return "❌ Failed to revoke token"
  return `✅ Token revoked: ${token.name}`
}

async function sendTelegram(chatId: number, text: string) {
  await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "Markdown" }),
  })
}
