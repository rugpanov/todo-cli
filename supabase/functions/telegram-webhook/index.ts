import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

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
  const text = message.text

  let response: string

  if (text.startsWith("/add")) {
    response = await handleAdd(chatId, text)
  } else if (text.startsWith("/list")) {
    response = await handleList(chatId)
  } else if (text.startsWith("/done")) {
    response = await handleDone(chatId, text)
  } else if (text.startsWith("/snooze")) {
    response = await handleSnooze(chatId, text)
  } else if (text.startsWith("/subtask")) {
    response = await handleSubtask(chatId, text)
  } else if (text.startsWith("/start")) {
    response = "👋 Welcome to TODO Tracker!\n\nCommands:\n/add <task> - Add task\n/list - Show tasks\n/done <id> - Complete task\n/snooze <id> - Postpone to tomorrow\n/subtask <id> <task> - Add subtask"
  } else {
    response = "❌ Unknown command. Use /add, /list, /done, /snooze, or /subtask"
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

async function sendTelegram(chatId: number, text: string) {
  await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  })
}
