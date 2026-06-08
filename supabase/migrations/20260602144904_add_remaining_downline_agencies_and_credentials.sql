/*
  # Add remaining downline agencies and admin credentials

  1. New Agencies (22 total)
    - Almond Family Insurance Llc (slug: almond-family-insurance)
    - American Entitlements Llc (slug: american-entitlements)
    - American Senior Health And Life Llc (slug: american-senior-health)
    - Dh Insurance Group (slug: dh-insurance)
    - Drivegen Media Dba Pro Health Partners (slug: pro-health-partners)
    - Healthcare123 Insurance Services Llc (slug: healthcare123)
    - Insurance Sales Experts (slug: insurance-sales-experts)
    - McKenzie Real Holdings Llc (slug: mckenzie-real)
    - Medicare Health Advisors (slug: medicare-health-advisors)
    - Partners In Care Insurance Llc (slug: partners-in-care)
    - Pitch Health Solutions Llc (slug: pitch-health)
    - Providence Group (slug: providence-group)
    - Residual Brothers Llc (slug: residual-brothers)
    - Rl Advisors (slug: rl-advisors)
    - Senior Benefits Agency Llc (slug: senior-benefits)
    - Senior Services Direct (slug: senior-services-direct)
    - Signature Medicare Solutions (slug: signature-medicare)
    - Silver Care Advisors Llc (slug: silver-care)
    - Steel City Financial Services Inc. (slug: steel-city)
    - The Premier Agency Llc (slug: premier-agency)
    - Trucare Insurance Group Inc (slug: trucare)
    - Wealth Alliance Group (slug: wealth-alliance)

  2. New Admin Credentials
    - Each agency receives a unique username (short slug) and random password
    - Role: agency_admin
    - Session duration: 90 days

  3. Backfill
    - Links existing form_submissions to the new agency_id records
*/

-- 1. Insert new agencies
INSERT INTO agencies (name, slug) VALUES
  ('Almond Family Insurance Llc', 'almond-family-insurance'),
  ('American Entitlements Llc', 'american-entitlements'),
  ('American Senior Health And Life Llc', 'american-senior-health'),
  ('Dh Insurance Group', 'dh-insurance'),
  ('Drivegen Media Dba Pro Health Partners', 'pro-health-partners'),
  ('Healthcare123 Insurance Services Llc', 'healthcare123'),
  ('Insurance Sales Experts', 'insurance-sales-experts'),
  ('McKenzie Real Holdings Llc', 'mckenzie-real'),
  ('Medicare Health Advisors', 'medicare-health-advisors'),
  ('Partners In Care Insurance Llc', 'partners-in-care'),
  ('Pitch Health Solutions Llc', 'pitch-health'),
  ('Providence Group', 'providence-group'),
  ('Residual Brothers Llc', 'residual-brothers'),
  ('Rl Advisors', 'rl-advisors'),
  ('Senior Benefits Agency Llc', 'senior-benefits'),
  ('Senior Services Direct', 'senior-services-direct'),
  ('Signature Medicare Solutions', 'signature-medicare'),
  ('Silver Care Advisors Llc', 'silver-care'),
  ('Steel City Financial Services Inc.', 'steel-city'),
  ('The Premier Agency Llc', 'premier-agency'),
  ('Trucare Insurance Group Inc', 'trucare'),
  ('Wealth Alliance Group', 'wealth-alliance')
ON CONFLICT (slug) DO NOTHING;

-- 2. Insert admin credentials for each new agency
INSERT INTO admin_credentials (email_domain, password, role, agency_id, session_duration_days)
SELECT 'Almond-Family', 'Afi#8mRx4Lw7Kp', 'agency_admin', id, 90
FROM agencies WHERE slug = 'almond-family-insurance'
ON CONFLICT DO NOTHING;

INSERT INTO admin_credentials (email_domain, password, role, agency_id, session_duration_days)
SELECT 'American-Entitlements', 'Aen$3nQz9Yv2Jd', 'agency_admin', id, 90
FROM agencies WHERE slug = 'american-entitlements'
ON CONFLICT DO NOTHING;

INSERT INTO admin_credentials (email_domain, password, role, agency_id, session_duration_days)
SELECT 'American-Senior', 'Ash@6kTs2Xm5Wf', 'agency_admin', id, 90
FROM agencies WHERE slug = 'american-senior-health'
ON CONFLICT DO NOTHING;

INSERT INTO admin_credentials (email_domain, password, role, agency_id, session_duration_days)
SELECT 'DH-Insurance', 'Dhi#9pLm4Rn7Vq', 'agency_admin', id, 90
FROM agencies WHERE slug = 'dh-insurance'
ON CONFLICT DO NOTHING;

INSERT INTO admin_credentials (email_domain, password, role, agency_id, session_duration_days)
SELECT 'Pro-Health', 'Php$5wFx8Gz3Bt', 'agency_admin', id, 90
FROM agencies WHERE slug = 'pro-health-partners'
ON CONFLICT DO NOTHING;

INSERT INTO admin_credentials (email_domain, password, role, agency_id, session_duration_days)
SELECT 'Healthcare123', 'Hc1@7jDn2Ks6Mx', 'agency_admin', id, 90
FROM agencies WHERE slug = 'healthcare123'
ON CONFLICT DO NOTHING;

INSERT INTO admin_credentials (email_domain, password, role, agency_id, session_duration_days)
SELECT 'Insurance-Experts', 'Ise#4tHv9Wp1Ry', 'agency_admin', id, 90
FROM agencies WHERE slug = 'insurance-sales-experts'
ON CONFLICT DO NOTHING;

INSERT INTO admin_credentials (email_domain, password, role, agency_id, session_duration_days)
SELECT 'McKenzie-Real', 'Mrh$6bCq3Nf8Lz', 'agency_admin', id, 90
FROM agencies WHERE slug = 'mckenzie-real'
ON CONFLICT DO NOTHING;

INSERT INTO admin_credentials (email_domain, password, role, agency_id, session_duration_days)
SELECT 'Medicare-Advisors', 'Mha@2xSv7Jk4Pw', 'agency_admin', id, 90
FROM agencies WHERE slug = 'medicare-health-advisors'
ON CONFLICT DO NOTHING;

INSERT INTO admin_credentials (email_domain, password, role, agency_id, session_duration_days)
SELECT 'Partners-In-Care', 'Pic#8gYm5Td1Hn', 'agency_admin', id, 90
FROM agencies WHERE slug = 'partners-in-care'
ON CONFLICT DO NOTHING;

INSERT INTO admin_credentials (email_domain, password, role, agency_id, session_duration_days)
SELECT 'Pitch-Health', 'Phs$3fRw6Zx9Cq', 'agency_admin', id, 90
FROM agencies WHERE slug = 'pitch-health'
ON CONFLICT DO NOTHING;

INSERT INTO admin_credentials (email_domain, password, role, agency_id, session_duration_days)
SELECT 'Providence', 'Pvg@7kNb4Lm2Wx', 'agency_admin', id, 90
FROM agencies WHERE slug = 'providence-group'
ON CONFLICT DO NOTHING;

INSERT INTO admin_credentials (email_domain, password, role, agency_id, session_duration_days)
SELECT 'Residual-Brothers', 'Rbl#5tJp8Hy3Dv', 'agency_admin', id, 90
FROM agencies WHERE slug = 'residual-brothers'
ON CONFLICT DO NOTHING;

INSERT INTO admin_credentials (email_domain, password, role, agency_id, session_duration_days)
SELECT 'RL-Advisors', 'Rla$2mWx6Fn9Gk', 'agency_admin', id, 90
FROM agencies WHERE slug = 'rl-advisors'
ON CONFLICT DO NOTHING;

INSERT INTO admin_credentials (email_domain, password, role, agency_id, session_duration_days)
SELECT 'Senior-Benefits', 'Sba@4pVz7Qs1Ry', 'agency_admin', id, 90
FROM agencies WHERE slug = 'senior-benefits'
ON CONFLICT DO NOTHING;

INSERT INTO admin_credentials (email_domain, password, role, agency_id, session_duration_days)
SELECT 'Senior-Services', 'Ssd#9cLn3Xw5Hm', 'agency_admin', id, 90
FROM agencies WHERE slug = 'senior-services-direct'
ON CONFLICT DO NOTHING;

INSERT INTO admin_credentials (email_domain, password, role, agency_id, session_duration_days)
SELECT 'Signature-Medicare', 'Sms$6jBt8Kv2Dp', 'agency_admin', id, 90
FROM agencies WHERE slug = 'signature-medicare'
ON CONFLICT DO NOTHING;

INSERT INTO admin_credentials (email_domain, password, role, agency_id, session_duration_days)
SELECT 'Silver-Care', 'Sca@1wRx5Gn7Fz', 'agency_admin', id, 90
FROM agencies WHERE slug = 'silver-care'
ON CONFLICT DO NOTHING;

INSERT INTO admin_credentials (email_domain, password, role, agency_id, session_duration_days)
SELECT 'Steel-City', 'Scf#8mTq4Hy6Jv', 'agency_admin', id, 90
FROM agencies WHERE slug = 'steel-city'
ON CONFLICT DO NOTHING;

INSERT INTO admin_credentials (email_domain, password, role, agency_id, session_duration_days)
SELECT 'Premier-Agency', 'Tpa$3kNw9Lx1Bz', 'agency_admin', id, 90
FROM agencies WHERE slug = 'premier-agency'
ON CONFLICT DO NOTHING;

INSERT INTO admin_credentials (email_domain, password, role, agency_id, session_duration_days)
SELECT 'Trucare', 'Tig@7pFm2Sv5Cq', 'agency_admin', id, 90
FROM agencies WHERE slug = 'trucare'
ON CONFLICT DO NOTHING;

INSERT INTO admin_credentials (email_domain, password, role, agency_id, session_duration_days)
SELECT 'Wealth-Alliance', 'Wag#4dJx8Rn6Ky', 'agency_admin', id, 90
FROM agencies WHERE slug = 'wealth-alliance'
ON CONFLICT DO NOTHING;

-- 3. Backfill agency_id on form_submissions for the new agencies
UPDATE form_submissions fs
SET agency_id = a.id
FROM agencies a
WHERE fs.agency = a.name
  AND fs.agency_id IS NULL;
