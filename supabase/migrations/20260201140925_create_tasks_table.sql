CREATE TABLE tasks (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  due_date DATE DEFAULT CURRENT_DATE + 1,
  priority TEXT DEFAULT 'P1' CHECK (priority IN ('P0','P1','P2','P3','P4')),
  status TEXT DEFAULT 'Todo' CHECK (status IN ('Todo','Done')),
  parent_id INTEGER REFERENCES tasks(id),
  user_id TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_tasks_user_id ON tasks(user_id);
CREATE INDEX idx_tasks_due_date ON tasks(due_date);
CREATE INDEX idx_tasks_status ON tasks(status);
