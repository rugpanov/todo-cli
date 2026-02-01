import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const supabaseUrl = Deno.env.get("SUPABASE_URL")!
const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN")!
const chatId = Deno.env.get("TELEGRAM_CHAT_ID")!

const supabase = createClient(supabaseUrl, supabaseKey)

serve(async (req) => {
  const now = new Date()
  const today = now.toISOString().split("T")[0]
  
  // Calculate week boundaries
  const weekAgo = new Date(now.getTime() - 7 * 86400000).toISOString().split("T")[0]
  const weekAhead = new Date(now.getTime() + 7 * 86400000).toISOString().split("T")[0]
  
  // Format date range for header
  const weekStart = new Date(now.getTime() - 6 * 86400000)
  const dateRange = `${weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${now.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`

  // Query completed this week
  const { data: completed } = await supabase
    .from("tasks")
    .select("*")
    .eq("user_id", chatId)
    .eq("status", "Done")
    .gte("created_at", weekAgo + "T00:00:00")
    .order("created_at", { ascending: false })

  // Query pending tasks
  const { data: pending } = await supabase
    .from("tasks")
    .select("*")
    .eq("user_id", chatId)
    .eq("status", "Todo")
    .order("priority")
    .order("due_date")

  // Query tasks added this week
  const { data: added } = await supabase
    .from("tasks")
    .select("id")
    .eq("user_id", chatId)
    .gte("created_at", weekAgo + "T00:00:00")

  // Query upcoming next week
  const { data: upcoming } = await supabase
    .from("tasks")
    .select("*")
    .eq("user_id", chatId)
    .eq("status", "Todo")
    .gt("due_date", today)
    .lte("due_date", weekAhead)
    .order("due_date")
    .order("priority")

  // Calculate stats
  const completedCount = completed?.length || 0
  const addedCount = added?.length || 0
  const pendingCount = pending?.length || 0
  const totalTasks = completedCount + pendingCount
  const completionRate = totalTasks > 0 ? Math.round((completedCount / totalTasks) * 100) : 0

  // Build message
  let message = `📊 Weekly Review — Week of ${dateRange}\n`

  if (completed && completed.length > 0) {
    message += `\n✅ COMPLETED THIS WEEK (${completedCount})\n`
    for (const t of completed.slice(0, 10)) {
      message += `• ${t.title}\n`
    }
    if (completed.length > 10) message += `...and ${completed.length - 10} more\n`
  }

  if (pending && pending.length > 0) {
    message += `\n📋 STILL PENDING (${pendingCount})\n`
    for (const t of pending.slice(0, 10)) {
      const overdue = t.due_date < today ? ` — was due ${t.due_date}` : ` — due ${t.due_date}`
      message += `• [${t.priority}] ${t.title}${overdue}\n`
    }
    if (pending.length > 10) message += `...and ${pending.length - 10} more\n`
  }

  message += `\n📈 STATS\n`
  message += `• Completion rate: ${completionRate}%\n`
  message += `• Tasks completed: ${completedCount}\n`
  message += `• Tasks added: ${addedCount}\n`

  if (upcoming && upcoming.length > 0) {
    message += `\n🎯 UPCOMING NEXT WEEK (${upcoming.length})\n`
    for (const t of upcoming.slice(0, 10)) {
      message += `• [${t.priority}] ${t.title} — due ${t.due_date}\n`
    }
    if (upcoming.length > 10) message += `...and ${upcoming.length - 10} more\n`
  }

  message += `\nHave a great week ahead! 🚀`

  // Send to Telegram
  await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text: message }),
  })

  return new Response(JSON.stringify({ success: true, message: "Weekly report sent" }), {
    headers: { "Content-Type": "application/json" },
  })
})
