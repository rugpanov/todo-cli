import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const supabaseUrl = Deno.env.get("TODO_CLI_SUPABASE_URL") || Deno.env.get("SUPABASE_URL")!
const supabaseKey = Deno.env.get("TODO_CLI_SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
const botToken = Deno.env.get("TODO_CLI_TELEGRAM_BOT_TOKEN") || Deno.env.get("TELEGRAM_BOT_TOKEN")!
const chatId = Deno.env.get("TODO_CLI_TELEGRAM_CHAT_ID") || Deno.env.get("TELEGRAM_CHAT_ID")!

const supabase = createClient(supabaseUrl, supabaseKey)

serve(async (req) => {
  // Allow both GET (for cron) and POST
  const today = new Date().toISOString().split("T")[0]
  const yesterday = new Date(Date.now() - 86400000).toISOString().split("T")[0]
  const tomorrow = new Date(Date.now() + 86400000).toISOString().split("T")[0]
  const dayAfter = new Date(Date.now() + 2 * 86400000).toISOString().split("T")[0]

  // Query overdue tasks
  const { data: overdue } = await supabase
    .from("tasks")
    .select("*")
    .eq("user_id", chatId)
    .eq("status", "Todo")
    .lt("due_date", today)
    .order("priority")
    .order("due_date")

  // Query today's tasks
  const { data: todayTasks } = await supabase
    .from("tasks")
    .select("*")
    .eq("user_id", chatId)
    .eq("status", "Todo")
    .eq("due_date", today)
    .order("priority")

  // Query next 2 days
  const { data: upcoming } = await supabase
    .from("tasks")
    .select("*")
    .eq("user_id", chatId)
    .eq("status", "Todo")
    .gt("due_date", today)
    .lte("due_date", dayAfter)
    .order("priority")
    .order("due_date")

  // Query completed yesterday
  const { data: completed } = await supabase
    .from("tasks")
    .select("*")
    .eq("user_id", chatId)
    .eq("status", "Done")
    .gte("created_at", yesterday + "T00:00:00")
    .lt("created_at", today + "T00:00:00")

  // Build message
  let message = "☀️ Good morning! Here's your task overview:\n"
  let hasContent = false

  if (overdue && overdue.length > 0) {
    hasContent = true
    message += `\n🔴 OVERDUE (${overdue.length})\n`
    for (const t of overdue.slice(0, 10)) {
      message += `• [${t.priority}] ${t.title} — was due ${t.due_date}\n`
    }
    if (overdue.length > 10) message += `...and ${overdue.length - 10} more\n`
  }

  if (todayTasks && todayTasks.length > 0) {
    hasContent = true
    message += `\n📅 TODAY (${todayTasks.length})\n`
    for (const t of todayTasks.slice(0, 10)) {
      message += `• [${t.priority}] ${t.title}\n`
    }
    if (todayTasks.length > 10) message += `...and ${todayTasks.length - 10} more\n`
  }

  if (upcoming && upcoming.length > 0) {
    hasContent = true
    message += `\n📆 NEXT 2 DAYS (${upcoming.length})\n`
    for (const t of upcoming.slice(0, 10)) {
      message += `• [${t.priority}] ${t.title} — due ${t.due_date}\n`
    }
    if (upcoming.length > 10) message += `...and ${upcoming.length - 10} more\n`
  }

  if (completed && completed.length > 0) {
    hasContent = true
    message += `\n✅ COMPLETED YESTERDAY (${completed.length})\n`
    message += "Great job! You finished:\n"
    for (const t of completed.slice(0, 10)) {
      message += `• ${t.title}\n`
    }
  }

  if (!hasContent) {
    message = "🎉 No pending tasks! Enjoy your day."
  } else {
    message += "\nHave a productive day! 💪"
  }

  // Send to Telegram
  await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text: message }),
  })

  return new Response(JSON.stringify({ success: true, message: "Digest sent" }), {
    headers: { "Content-Type": "application/json" },
  })
})
