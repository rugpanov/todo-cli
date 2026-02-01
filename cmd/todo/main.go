package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/joho/godotenv"
)

var (
	supabaseURL string
	supabaseKey string
	userID      string
)

type Task struct {
	ID        int    `json:"id"`
	Title     string `json:"title"`
	DueDate   string `json:"due_date"`
	Priority  string `json:"priority"`
	Status    string `json:"status"`
	ParentID  *int   `json:"parent_id"`
	UserID    string `json:"user_id"`
	CreatedAt string `json:"created_at"`
}

func main() {
	// Load .env file from executable directory or current directory
	if exe, err := os.Executable(); err == nil {
		godotenv.Load(filepath.Join(filepath.Dir(exe), ".env"))
	}
	godotenv.Load() // Also try current directory

	supabaseURL = os.Getenv("SUPABASE_URL")
	supabaseKey = os.Getenv("SUPABASE_SERVICE_ROLE_KEY")
	userID = os.Getenv("TELEGRAM_CHAT_ID")

	if supabaseURL == "" || supabaseKey == "" {
		fmt.Println("❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment")
		os.Exit(1)
	}

	if userID == "" {
		userID = "cli"
	}

	if len(os.Args) < 2 {
		printHelp()
		os.Exit(0)
	}

	cmd := os.Args[1]
	args := os.Args[2:]

	switch cmd {
	case "add":
		cmdAdd(args)
	case "list", "ls":
		cmdList()
	case "done":
		cmdDone(args)
	case "snooze":
		cmdSnooze(args)
	case "subtask":
		cmdSubtask(args)
	case "help", "--help", "-h":
		printHelp()
	default:
		fmt.Printf("❌ Unknown command: %s\n", cmd)
		printHelp()
		os.Exit(1)
	}
}

func printHelp() {
	fmt.Println(`TODO Tracker CLI

Usage: todo <command> [arguments]

Commands:
  add <task> [date]      Add a new task (default: due tomorrow, P1)
                         Examples:
                           todo add "Buy groceries"
                           todo add "Meeting" today
                           todo add "[P2] Report" 2026-02-15

  list, ls               Show all pending tasks

  done <id>              Mark task as complete
                         Example: todo done 5

  snooze <id>            Postpone task to tomorrow
                         Example: todo snooze 3

  subtask <id> <task>    Add subtask to existing task
                         Example: todo subtask 2 "Review section"

  help                   Show this help message`)
}

func cmdAdd(args []string) {
	if len(args) == 0 {
		fmt.Println("❌ Missing task title. Usage: todo add <task> [date]")
		os.Exit(1)
	}

	text := strings.Join(args, " ")
	priority := "P1"
	tomorrow := time.Now().AddDate(0, 0, 1).Format("2006-01-02")
	dueDate := tomorrow

	// Parse priority [P0-P4]
	prioRegex := regexp.MustCompile(`\[P([0-4])\]`)
	if match := prioRegex.FindStringSubmatch(text); match != nil {
		priority = "P" + match[1]
		text = strings.TrimSpace(prioRegex.ReplaceAllString(text, ""))
	}

	// Parse date (last word)
	words := strings.Fields(text)
	if len(words) > 1 {
		lastWord := words[len(words)-1]
		if lastWord == "today" {
			dueDate = time.Now().Format("2006-01-02")
			text = strings.Join(words[:len(words)-1], " ")
		} else if lastWord == "tomorrow" {
			dueDate = tomorrow
			text = strings.Join(words[:len(words)-1], " ")
		} else if matched, _ := regexp.MatchString(`^\d{4}-\d{2}-\d{2}$`, lastWord); matched {
			dueDate = lastWord
			text = strings.Join(words[:len(words)-1], " ")
		}
	}

	task := map[string]interface{}{
		"title":    text,
		"due_date": dueDate,
		"priority": priority,
		"status":   "Todo",
		"user_id":  userID,
	}

	result, err := supabaseInsert("tasks", task)
	if err != nil {
		fmt.Printf("❌ Failed to add task: %v\n", err)
		os.Exit(1)
	}

	fmt.Printf("✅ Task added: %s — due %s [%s]\n", result.Title, result.DueDate, result.Priority)
}

func cmdList() {
	tasks, err := supabaseSelect("tasks", fmt.Sprintf("user_id=eq.%s&status=eq.Todo&order=priority,due_date", userID))
	if err != nil {
		fmt.Printf("❌ Failed to fetch tasks: %v\n", err)
		os.Exit(1)
	}

	if len(tasks) == 0 {
		fmt.Println("🎉 No pending tasks!")
		return
	}

	today := time.Now().Format("2006-01-02")
	fmt.Println("📋 All pending tasks:\n")

	for _, t := range tasks {
		overdue := ""
		if t.DueDate < today {
			overdue = " \033[31m⚠️ overdue\033[0m"
		}

		dueInfo := ""
		if t.DueDate == today {
			dueInfo = " \033[33m(today)\033[0m"
		} else {
			dueInfo = fmt.Sprintf(" — due %s", t.DueDate)
		}

		fmt.Printf("[id:%d] [%s] %s%s%s\n", t.ID, t.Priority, t.Title, dueInfo, overdue)
	}
}

func cmdDone(args []string) {
	if len(args) == 0 {
		fmt.Println("❌ Missing task ID. Usage: todo done <id>")
		os.Exit(1)
	}

	id, err := strconv.Atoi(args[0])
	if err != nil {
		fmt.Println("❌ Invalid task ID")
		os.Exit(1)
	}

	task, err := supabaseUpdate("tasks", id, map[string]interface{}{"status": "Done"})
	if err != nil {
		fmt.Printf("❌ Failed to complete task: %v\n", err)
		os.Exit(1)
	}

	fmt.Printf("✅ Marked as done: %s\n", task.Title)
}

func cmdSnooze(args []string) {
	if len(args) == 0 {
		fmt.Println("❌ Missing task ID. Usage: todo snooze <id>")
		os.Exit(1)
	}

	id, err := strconv.Atoi(args[0])
	if err != nil {
		fmt.Println("❌ Invalid task ID")
		os.Exit(1)
	}

	tomorrow := time.Now().AddDate(0, 0, 1).Format("2006-01-02")
	task, err := supabaseUpdate("tasks", id, map[string]interface{}{"due_date": tomorrow})
	if err != nil {
		fmt.Printf("❌ Failed to snooze task: %v\n", err)
		os.Exit(1)
	}

	fmt.Printf("✅ Snoozed: %s — now due %s\n", task.Title, tomorrow)
}

func cmdSubtask(args []string) {
	if len(args) < 2 {
		fmt.Println("❌ Usage: todo subtask <parent_id> <task>")
		os.Exit(1)
	}

	parentID, err := strconv.Atoi(args[0])
	if err != nil {
		fmt.Println("❌ Invalid parent task ID")
		os.Exit(1)
	}

	title := strings.Join(args[1:], " ")

	// Get parent task for defaults
	parent, err := supabaseGetByID("tasks", parentID)
	if err != nil {
		fmt.Printf("❌ Parent task not found: %v\n", err)
		os.Exit(1)
	}

	task := map[string]interface{}{
		"title":     title,
		"due_date":  parent.DueDate,
		"priority":  parent.Priority,
		"status":    "Todo",
		"parent_id": parentID,
		"user_id":   userID,
	}

	result, err := supabaseInsert("tasks", task)
	if err != nil {
		fmt.Printf("❌ Failed to add subtask: %v\n", err)
		os.Exit(1)
	}

	fmt.Printf("✅ Subtask added: %s (under #%d)\n", result.Title, parentID)
}

// Supabase API helpers

func supabaseInsert(table string, data map[string]interface{}) (*Task, error) {
	body, _ := json.Marshal(data)
	req, _ := http.NewRequest("POST", fmt.Sprintf("%s/rest/v1/%s", supabaseURL, table), bytes.NewBuffer(body))
	req.Header.Set("apikey", supabaseKey)
	req.Header.Set("Authorization", "Bearer "+supabaseKey)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Prefer", "return=representation")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)
	var tasks []Task
	if err := json.Unmarshal(respBody, &tasks); err != nil {
		return nil, fmt.Errorf("parse error: %s", string(respBody))
	}
	if len(tasks) == 0 {
		return nil, fmt.Errorf("no task returned")
	}
	return &tasks[0], nil
}

func supabaseSelect(table, query string) ([]Task, error) {
	req, _ := http.NewRequest("GET", fmt.Sprintf("%s/rest/v1/%s?%s", supabaseURL, table, query), nil)
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

func supabaseGetByID(table string, id int) (*Task, error) {
	tasks, err := supabaseSelect(table, fmt.Sprintf("id=eq.%d", id))
	if err != nil {
		return nil, err
	}
	if len(tasks) == 0 {
		return nil, fmt.Errorf("not found")
	}
	return &tasks[0], nil
}

func supabaseUpdate(table string, id int, data map[string]interface{}) (*Task, error) {
	body, _ := json.Marshal(data)
	req, _ := http.NewRequest("PATCH", fmt.Sprintf("%s/rest/v1/%s?id=eq.%d", supabaseURL, table, id), bytes.NewBuffer(body))
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
		return nil, fmt.Errorf("task not found")
	}
	return &tasks[0], nil
}
