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

	"github.com/fsnotify/fsnotify"
	"github.com/joho/godotenv"
)

var (
	supabaseURL string
	supabaseKey string
	userID      string
	todoFile    string
	debounce    = 2 * time.Second
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
	// Load .env
	if exe, err := os.Executable(); err == nil {
		godotenv.Load(filepath.Join(filepath.Dir(exe), ".env"))
	}
	godotenv.Load()

	supabaseURL = os.Getenv("SUPABASE_URL")
	supabaseKey = os.Getenv("SUPABASE_SERVICE_ROLE_KEY")
	userID = os.Getenv("TELEGRAM_CHAT_ID")
	todoFile = os.Getenv("TODO_CLI_FILE")

	if supabaseURL == "" || supabaseKey == "" {
		fmt.Println("❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")
		os.Exit(1)
	}

	if todoFile == "" {
		fmt.Println("❌ Missing TODO_CLI_FILE environment variable")
		fmt.Println("   Set it to your todo.md path, e.g.:")
		fmt.Println("   export TODO_CLI_FILE=~/Documents/todo/todo.md")
		os.Exit(1)
	}

	// Expand ~ to home directory
	if strings.HasPrefix(todoFile, "~") {
		home, _ := os.UserHomeDir()
		todoFile = filepath.Join(home, todoFile[1:])
	}

	if userID == "" {
		userID = "cli"
	}

	// Check for subcommands
	if len(os.Args) > 1 {
		switch os.Args[1] {
		case "export":
			exportToMarkdown()
			return
		case "watch":
			// Continue to watch mode
		case "help", "--help", "-h":
			fmt.Println(`Obsidian Sync - Two-way sync between Supabase and Obsidian

Usage: obsidian-sync [command]

Commands:
  export    Export tasks from Supabase to markdown file
  watch     Watch file for changes and sync back (default)
  help      Show this help message

Environment:
  TODO_CLI_FILE       Path to your todo.md file (required)`)
			return
		}
	}

	// Check if file exists, create if not
	if _, err := os.Stat(todoFile); os.IsNotExist(err) {
		fmt.Printf("📝 Creating %s\n", todoFile)
		os.MkdirAll(filepath.Dir(todoFile), 0755)
		exportToMarkdown()
	}

	fmt.Printf("👀 Watching %s for changes...\n", todoFile)
	fmt.Println("   Press Ctrl+C to stop")
	fmt.Println("   Edit checkboxes in Obsidian to sync status changes")
	fmt.Println("   Run 'obsidian-sync export' to refresh from Supabase")

	// Watch for changes
	watchFile()
}

func watchFile() {
	watcher, err := fsnotify.NewWatcher()
	if err != nil {
		fmt.Printf("❌ Failed to create watcher: %v\n", err)
		os.Exit(1)
	}
	defer watcher.Close()

	// Watch the directory (more reliable than watching file directly)
	dir := filepath.Dir(todoFile)
	err = watcher.Add(dir)
	if err != nil {
		fmt.Printf("❌ Failed to watch directory: %v\n", err)
		os.Exit(1)
	}

	var lastEvent time.Time
	filename := filepath.Base(todoFile)

	for {
		select {
		case event, ok := <-watcher.Events:
			if !ok {
				return
			}
			// Only process our file
			if filepath.Base(event.Name) != filename {
				continue
			}
			if event.Op&fsnotify.Write == fsnotify.Write {
				// Debounce
				if time.Since(lastEvent) < debounce {
					continue
				}
				lastEvent = time.Now()

				fmt.Printf("📝 File changed, syncing...\n")
				time.Sleep(500 * time.Millisecond) // Wait for file to be fully written
				syncFromMarkdown()
			}
		case err, ok := <-watcher.Errors:
			if !ok {
				return
			}
			fmt.Printf("⚠️ Watcher error: %v\n", err)
		}
	}
}

func exportToMarkdown() {
	tasks, err := fetchTasks()
	if err != nil {
		fmt.Printf("❌ Failed to fetch tasks: %v\n", err)
		return
	}

	today := time.Now().Format("2006-01-02")
	var overdue, todayTasks, upcoming []Task

	for _, t := range tasks {
		if t.DueDate < today {
			overdue = append(overdue, t)
		} else if t.DueDate == today {
			todayTasks = append(todayTasks, t)
		} else {
			upcoming = append(upcoming, t)
		}
	}

	var sb strings.Builder
	sb.WriteString("# TODO List\n\n")

	if len(overdue) > 0 {
		sb.WriteString("## Overdue\n")
		for _, t := range overdue {
			sb.WriteString(formatTaskMD(t))
		}
		sb.WriteString("\n")
	}

	if len(todayTasks) > 0 {
		sb.WriteString("## Today\n")
		for _, t := range todayTasks {
			sb.WriteString(formatTaskMD(t))
		}
		sb.WriteString("\n")
	}

	if len(upcoming) > 0 {
		sb.WriteString("## Upcoming\n")
		for _, t := range upcoming {
			sb.WriteString(formatTaskMD(t))
		}
		sb.WriteString("\n")
	}

	if len(tasks) == 0 {
		sb.WriteString("No pending tasks! 🎉\n")
	}

	err = os.WriteFile(todoFile, []byte(sb.String()), 0644)
	if err != nil {
		fmt.Printf("❌ Failed to write file: %v\n", err)
		return
	}
	fmt.Printf("✅ Exported %d tasks to %s\n", len(tasks), todoFile)
}

func formatTaskMD(t Task) string {
	checkbox := "- [ ]"
	if t.Status == "Done" {
		checkbox = "- [x]"
	}
	dueInfo := ""
	today := time.Now().Format("2006-01-02")
	if t.DueDate != today {
		dueInfo = fmt.Sprintf(" — due %s", t.DueDate)
	}
	return fmt.Sprintf("%s [%s] %s%s <!-- id:%d -->\n", checkbox, t.Priority, t.Title, dueInfo, t.ID)
}

func syncFromMarkdown() {
	content, err := os.ReadFile(todoFile)
	if err != nil {
		fmt.Printf("❌ Failed to read file: %v\n", err)
		return
	}

	// Parse checkboxes with IDs
	// Format: - [x] [P1] Task title — due 2026-02-02 <!-- id:5 -->
	re := regexp.MustCompile(`- \[([ x])\] \[P\d\] .* <!-- id:(\d+) -->`)
	matches := re.FindAllStringSubmatch(string(content), -1)

	for _, match := range matches {
		checked := match[1] == "x"
		id, _ := strconv.Atoi(match[2])

		// Get current task status
		task, err := fetchTaskByID(id)
		if err != nil {
			continue
		}

		newStatus := "Todo"
		if checked {
			newStatus = "Done"
		}

		if task.Status != newStatus {
			err = updateTaskStatus(id, newStatus)
			if err != nil {
				fmt.Printf("❌ Failed to update task %d: %v\n", id, err)
			} else {
				fmt.Printf("✅ Task %d: %s → %s\n", id, task.Status, newStatus)
			}
		}
	}
}

// API helpers

func fetchTasks() ([]Task, error) {
	url := fmt.Sprintf("%s/rest/v1/tasks?user_id=eq.%s&status=eq.Todo&order=priority,due_date", supabaseURL, userID)
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

func fetchTaskByID(id int) (*Task, error) {
	url := fmt.Sprintf("%s/rest/v1/tasks?id=eq.%d", supabaseURL, id)
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
	if len(tasks) == 0 {
		return nil, fmt.Errorf("not found")
	}
	return &tasks[0], nil
}

func updateTaskStatus(id int, status string) error {
	url := fmt.Sprintf("%s/rest/v1/tasks?id=eq.%d", supabaseURL, id)
	body, _ := json.Marshal(map[string]string{"status": status})
	req, _ := http.NewRequest("PATCH", url, bytes.NewBuffer(body))
	req.Header.Set("apikey", supabaseKey)
	req.Header.Set("Authorization", "Bearer "+supabaseKey)
	req.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("API error: %s", string(body))
	}
	return nil
}
