/*
  # Create admin credentials for remaining agencies

  1. New Records
    - Guardian Benefits Inc: username "Guardian", random password, agency_admin role
    - Guide To Insure Llc: username "Guide-To-Insure", random password, agency_admin role
    - Highland Health Direct Llc: username "Highland", random password, agency_admin role

  2. Details
    - Each linked to their respective agency_id
    - 90-day session duration (matching Wisechoice)
    - role = agency_admin for scoped access
*/

INSERT INTO admin_credentials (email_domain, password, role, agency_id, session_duration_days)
SELECT 'Guardian', 'Gbn#4mRx9Lw2Kp', 'agency_admin', id, 90
FROM agencies WHERE slug = 'guardian'
ON CONFLICT DO NOTHING;

INSERT INTO admin_credentials (email_domain, password, role, agency_id, session_duration_days)
SELECT 'Guide-To-Insure', 'Gti$7nQz3Yv8Jd', 'agency_admin', id, 90
FROM agencies WHERE slug = 'guide-to-insure'
ON CONFLICT DO NOTHING;

INSERT INTO admin_credentials (email_domain, password, role, agency_id, session_duration_days)
SELECT 'Highland', 'Hhd@5kTs6Xm1Wf', 'agency_admin', id, 90
FROM agencies WHERE slug = 'highland'
ON CONFLICT DO NOTHING;