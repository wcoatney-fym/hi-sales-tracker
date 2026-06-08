/*
  # Create EnrollHere Dialer Data Source

  Inserts a data_sources row for the EnrollHere Dialer API integration.
  This tracks polling history and is referenced by the enrollhere-poll edge function.
*/

INSERT INTO data_sources (name, type, description, api_url, api_key_secret_name, poll_interval)
VALUES (
  'EnrollHere Dialer',
  'api_pull',
  'Agent talk time and performance data from EnrollHere dialer',
  'https://api.enrollhere.com/v1/dialer/agents/performance',
  'ENROLLHERE_API_KEY',
  '1 hour'
)
ON CONFLICT DO NOTHING;
