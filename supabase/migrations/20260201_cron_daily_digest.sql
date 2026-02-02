-- Enable pg_cron extension
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Schedule daily digest at 6:30 UTC (7:30 CET)
SELECT cron.schedule(
  'daily-digest',
  '30 6 * * *',
  $$
  SELECT net.http_post(
    url := 'https://awpmhcblqvvliarpcawk.supabase.co/functions/v1/daily-digest',
    headers := '{"Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF3cG1oY2JscXZ2bGlhcnBjYXdrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk5NTMyNjksImV4cCI6MjA4NTUyOTI2OX0.Q3LlZDciuP1Gm-elhl8-FlxCjNi4NlZ9M8PxAqNf1-8"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);
