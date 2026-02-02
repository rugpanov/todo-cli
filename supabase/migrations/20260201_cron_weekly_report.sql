-- Schedule weekly report for Sunday 5:00 PM UTC (6:00 PM CET)
SELECT cron.schedule(
  'weekly-report',
  '0 17 * * 0',
  $$
  SELECT net.http_post(
    url := 'https://awpmhcblqvvliarpcawk.supabase.co/functions/v1/weekly-report',
    headers := '{"Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF3cG1oY2JscXZ2bGlhcnBjYXdrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk5NTMyNjksImV4cCI6MjA4NTUyOTI2OX0.Q3LlZDciuP1Gm-elhl8-FlxCjNi4NlZ9M8PxAqNf1-8"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);
