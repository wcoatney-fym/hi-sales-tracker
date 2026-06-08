/*
  # Hard-code agency assignments for 4 agents

  1. Data Corrections
    - Tiara Clark: assigned to "Guardian Benefits Inc", agency locked
    - Yarissa Fernandez: assigned to "Guardian Benefits Inc", agency locked
    - Walter Villavicencio: assigned to "Guide To Insure LLC", agency locked
    - Kevin Corp: assigned to "Guardian Benefits Inc", agency locked

  2. Changes
    - Creates agents table records with correct agency and agency_locked = true
    - Updates form_submissions agency for all their existing records
*/

-- Create locked agent records
INSERT INTO agents (first_name, last_name, unl_writing_number, agency, agency_locked, source)
VALUES
  ('Tiara', 'Clark', '202NHS14', 'Guardian Benefits Inc', true, 'Data Source'),
  ('Yarissa', 'Fernandez', '202NEW42', 'Guardian Benefits Inc', true, 'Data Source'),
  ('Walter', 'Villavicencio', '202NHS17', 'Guide To Insure LLC', true, 'Data Source'),
  ('Kevin', 'Corp', '202NG901', 'Guardian Benefits Inc', true, 'Data Source')
ON CONFLICT DO NOTHING;

-- Fix form_submissions
UPDATE form_submissions
SET agency = 'Guardian Benefits Inc'
WHERE agent_first_name = 'Tiara' AND agent_last_name = 'Clark';

UPDATE form_submissions
SET agency = 'Guardian Benefits Inc'
WHERE agent_first_name = 'Yarissa' AND agent_last_name = 'Fernandez';

UPDATE form_submissions
SET agency = 'Guide To Insure LLC'
WHERE agent_first_name = 'Walter' AND agent_last_name = 'Villavicencio';

UPDATE form_submissions
SET agency = 'Guardian Benefits Inc'
WHERE agent_first_name = 'Kevin' AND agent_last_name = 'Corp';
