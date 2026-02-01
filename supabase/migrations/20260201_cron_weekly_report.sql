-- Schedule weekly report for Sunday 5:00 PM UTC (6:00 PM CET)
SELECT cron.schedule(
  'weekly-report',
  '0 17 * * 0',
  $$
  SELECT net.http_post(
    url := 'https://awpmhcblqvvliarpcawk.supabase.co/functions/v1/weekly-report',
    headers := '{"Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF3cG1oY2JscXZ2bGlhcnBjYXdrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzgzMjkzMTcsImV4cCI6MjA1MzkwNTMxN30.o-EHM0FGwPpJu6Ge7ePMKP_GYNCsOOqSzmLvSgPQbvI"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);
