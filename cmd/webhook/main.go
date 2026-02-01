package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// Telegram types
type Update struct {
	Message *Message `json:"message"`
}

type Message struct {
	Chat Chat   `json:"chat"`
	Text string `json:"text"`
}

type Chat struct {
	ID int64 `json:"id"`
}

// Supabase task
type Task struct {
	ID        int     `json:"id,omitempty"`
	Title     string  `json:"title"`
	DueDate   string  `json:"due_date,omitempty"`
	Priority  string  `json:"priority,omitempty"`
	Status    string  `json:"status,omitempty"`
	ParentID  *int    `json:"parent_id,omitempty"`
	UserID    string  `json:"user_id"`
	CreatedAt string  `json:"created_at,omitempty"`
}

var (
	supabaseURL string
	supabaseKey string
	botToken    string
)

func init() {
	supabaseURL = os.Getenv("SUPABASE_URL")
	supabaseKey = os.Getenv("SUPABASE_SERVICE_ROLE_KEY")
	botToken = os.Getenv("TELEGRAM_BOT_TOKEN")
}

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	http.HandleFunc("/webhook", handleWebhook)
	http.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("OK"))
	})

	log.Printf("Starting webhook server on port %s", port)
	log.Fatal(http.ListenAndServe(":"+port, nil))
}

func handleWebhook(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	body, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, "Failed to read body", http.StatusBadRequest)
		return
	}

	var update Update
	if err := json.Unmarshal(body, &update); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}

	if update.Message == nil || update.Message.Text == "" {
		w.WriteHeader(http.StatusOK)
		return
	}

	chatID := update.Message.Chat.ID
	text := update.Message.Text

	var response string
	switch {
	case strings.HasPrefix(text, "/add"):
		response = handleAdd(chatID, text)
	case strings.HasPrefix(text, "/list"):
		response = handleList(chatID)
	case strings.HasPrefix(text, "/done"):
		response = handleDone(chatID, text)
	case strings.HasPrefix(text, "/snooze"):
		response = handleSnooze(chatID, text)
	case strings.HasPrefix(text, "/subtask"):
		response = handleSubtask(chatID, text)
	case strings.HasPrefix(text, "/start"):
		response = "👋 Welcome to TODO Tracker!\n\nCommands:\n/add <task> - Add task\n/list - Show tasks\n/done <id> - Complete task\n/snooze <id> - Postpone to tomorrow\n/subtask <id> <task> - Add subtask"
	default:
		response = "❌ Unknown command. Use /add, /list, /done, /snooze, or /subtask"
	}

	sendTelegram(chatID, response)
	w.WriteHeader(http.StatusOK)
}

// /add [P#] <title> [date]
func handleAdd(chatID int64, text string) string {
	text = strings.TrimPrefix(text, "/add")
	text = strings.TrimSpace(text)

	if text == "" {
		return "❌ Missing task title. Usage: /add <task>"
	}

	priority := "P1"
	dueDate := time.Now().AddDate(0, 0, 1).Format("2006-01-02") // tomorrow

	// Parse priority [P0-P4]
	prioRegex := regexp.MustCompile(`\[P([0-4])\]`)
	if match := prioRegex.FindStringSubmatch(text); match != nil {
		priority = "P" + match[1]
		text = prioRegex.ReplaceAllString(text, "")
		text = strings.TrimSpace(text)
	}

	// Parse date
	words := strings.Fields(text)
	if len(words) > 1 {
		lastWord := words[len(words)-1]
		if lastWord == "today" {
			dueDate = time.Now().Format("2006-01-02")
			text = strings.Join(words[:len(words)-1], " ")
		} else if lastWord == "tomorrow" {
			dueDate = time.Now().AddDate(0, 0, 1).Format("2006-01-02")
			text = strings.Join(words[:len(words)-1], " ")
		} else if matched, _ := regexp.MatchString(`^\d{4}-\d{2}-\d{2}$`, lastWord); matched {
			dueDate = lastWord
			text = strings.Join(words[:len(words)-1], " ")
		}
	}

	task := Task{
		Title:    text,
		DueDate:  dueDate,
		Priority: priority,
		Status:   "Todo",
		UserID:   fmt.Sprintf("%d", chatID),
	}

	created, err := createTask(task)
	if err != nil {
		return "❌ Failed to add task: " + err.Error()
	}

	return fmt.Sprintf("✅ Task added: %s — due %s [%s]", created.Title, created.DueDate, created.Priority)
}

func handleList(chatID int64) string {
	today := time.Now().Format("2006-01-02")
	url := fmt.Sprintf("%s/rest/v1/tasks?user_id=eq.%d&status=eq.Todo&due_date=lte.%s&order=priority.asc,due_date.asc",
		supabaseURL, chatID, today)

	tasks, err := queryTasks(url)
	if err != nil {
		return "❌ Failed to fetch tasks: " + err.Error()
	}

	if len(tasks) == 0 {
		return "🎉 No pending tasks for today!"
	}

	var sb strings.Builder
	sb.WriteString("📋 Your tasks:\n\n")
	for i, t := range tasks {
		status := "⬜"
		sb.WriteString(fmt.Sprintf("%s [%d] [%s] %s", status, t.ID, t.Priority, t.Title))
		if t.DueDate < today {
			sb.WriteString(" ⚠️ overdue")
		}
		sb.WriteString("\n")
		if i >= 9 {
			sb.WriteString(fmt.Sprintf("...and %d more\n", len(tasks)-10))
			break
		}
	}

	return sb.String()
}

func handleDone(chatID int64, text string) string {
	text = strings.TrimPrefix(text, "/done")
	text = strings.TrimSpace(text)

	id, err := strconv.Atoi(text)
	if err != nil {
		return "❌ Invalid task ID. Usage: /done <id>"
	}

	task, err := getTask(id, chatID)
	if err != nil {
		return "❌ Task not found"
	}

	if err := updateTaskStatus(id, chatID, "Done"); err != nil {
		return "❌ Failed to update task"
	}

	return fmt.Sprintf("✅ Marked as done: %s", task.Title)
}

func handleSnooze(chatID int64, text string) string {
	text = strings.TrimPrefix(text, "/snooze")
	text = strings.TrimSpace(text)

	id, err := strconv.Atoi(text)
	if err != nil {
		return "❌ Invalid task ID. Usage: /snooze <id>"
	}

	task, err := getTask(id, chatID)
	if err != nil {
		return "❌ Task not found"
	}

	tomorrow := time.Now().AddDate(0, 0, 1).Format("2006-01-02")
	if err := updateTaskDueDate(id, chatID, tomorrow); err != nil {
		return "❌ Failed to snooze task"
	}

	return fmt.Sprintf("✅ Snoozed: %s — now due tomorrow", task.Title)
}

func handleSubtask(chatID int64, text string) string {
	text = strings.TrimPrefix(text, "/subtask")
	text = strings.TrimSpace(text)

	parts := strings.SplitN(text, " ", 2)
	if len(parts) < 2 {
		return "❌ Usage: /subtask <parent_id> <task title>"
	}

	parentID, err := strconv.Atoi(parts[0])
	if err != nil {
		return "❌ Invalid parent ID"
	}

	parent, err := getTask(parentID, chatID)
	if err != nil {
		return "❌ Parent task not found"
	}

	task := Task{
		Title:    parts[1],
		DueDate:  parent.DueDate,
		Priority: parent.Priority,
		Status:   "Todo",
		ParentID: &parentID,
		UserID:   fmt.Sprintf("%d", chatID),
	}

	_, err = createTask(task)
	if err != nil {
		return "❌ Failed to add subtask"
	}

	return fmt.Sprintf("✅ Subtask added to '%s': %s", parent.Title, parts[1])
}

// Supabase helpers
func createTask(task Task) (*Task, error) {
	url := supabaseURL + "/rest/v1/tasks"
	body, _ := json.Marshal(task)

	req, _ := http.NewRequest("POST", url, bytes.NewBuffer(body))
	req.Header.Set("apikey", supabaseKey)
	req.Header.Set("Authorization", "Bearer "+supabaseKey)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Prefer", "return=representation")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	var tasks []Task
	json.NewDecoder(resp.Body).Decode(&tasks)
	if len(tasks) == 0 {
		return nil, fmt.Errorf("no task returned")
	}
	return &tasks[0], nil
}

func queryTasks(url string) ([]Task, error) {
	req, _ := http.NewRequest("GET", url, nil)
	req.Header.Set("apikey", supabaseKey)
	req.Header.Set("Authorization", "Bearer "+supabaseKey)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	var tasks []Task
	json.NewDecoder(resp.Body).Decode(&tasks)
	return tasks, nil
}

func getTask(id int, chatID int64) (*Task, error) {
	url := fmt.Sprintf("%s/rest/v1/tasks?id=eq.%d&user_id=eq.%d", supabaseURL, id, chatID)
	tasks, err := queryTasks(url)
	if err != nil || len(tasks) == 0 {
		return nil, fmt.Errorf("not found")
	}
	return &tasks[0], nil
}

func updateTaskStatus(id int, chatID int64, status string) error {
	url := fmt.Sprintf("%s/rest/v1/tasks?id=eq.%d&user_id=eq.%d", supabaseURL, id, chatID)
	body, _ := json.Marshal(map[string]string{"status": status})

	req, _ := http.NewRequest("PATCH", url, bytes.NewBuffer(body))
	req.Header.Set("apikey", supabaseKey)
	req.Header.Set("Authorization", "Bearer "+supabaseKey)
	req.Header.Set("Content-Type", "application/json")

	_, err := http.DefaultClient.Do(req)
	return err
}

func updateTaskDueDate(id int, chatID int64, dueDate string) error {
	url := fmt.Sprintf("%s/rest/v1/tasks?id=eq.%d&user_id=eq.%d", supabaseURL, id, chatID)
	body, _ := json.Marshal(map[string]string{"due_date": dueDate})

	req, _ := http.NewRequest("PATCH", url, bytes.NewBuffer(body))
	req.Header.Set("apikey", supabaseKey)
	req.Header.Set("Authorization", "Bearer "+supabaseKey)
	req.Header.Set("Content-Type", "application/json")

	_, err := http.DefaultClient.Do(req)
	return err
}

// Telegram helper
func sendTelegram(chatID int64, text string) error {
	url := fmt.Sprintf("https://api.telegram.org/bot%s/sendMessage", botToken)
	body, _ := json.Marshal(map[string]interface{}{
		"chat_id": chatID,
		"text":    text,
	})

	resp, err := http.Post(url, "application/json", bytes.NewBuffer(body))
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	return nil
}
