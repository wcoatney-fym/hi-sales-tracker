# Security gates

## Identity and sessions

- Use a maintained identity provider, proven password hashing, individual accounts, and MFA for privileged access.
- Do not use names, public identifiers, policy/writing numbers, or obtainable personal data as authenticators.
- Add generic login errors, throttling, backoff/lockout, enumeration resistance, and monitoring.
- Prefer secure HttpOnly SameSite cookies where appropriate; protect cookie-authenticated mutations from CSRF.
- Keep sessions short, rotate refresh tokens, revoke on credential/role/account changes, and support global logout.
- Never trust cached client identity or authorization state.

## Authorization and tenancy

- Define an actor × action × resource permission matrix.
- Enforce authentication, role, ownership, and tenant membership on every server action and affected record.
- Derive identity and scope from the verified principal. Reject caller attempts to expand scope through filters, IDs, URLs, exports, or batch bodies.
- Scope reads, counts, search facets, exports, writes, jobs, and audit views consistently.
- Use deny-by-default RLS as defense in depth and test it with actual runtime roles.
- Resolve effective table grants, all permissive/restrictive policies, owner/BYPASSRLS behavior, `FORCE ROW LEVEL SECURITY`, views, RPC grants, `SECURITY DEFINER`, service-role access, and external database paths.
- Test both IDOR/horizontal access and lower-role/vertical escalation.

## Data, encryption, and database

- Inventory sensitive fields; minimize collection, replication, recipients, and retention.
- Distinguish TLS, provider disk/backup encryption, database column encryption, and application-layer envelope encryption; each covers different threats.
- When protection is required from snapshots, operators, support access, or broad service roles, use reviewed application-layer envelope encryption with managed KMS, separated permissions, authenticated encryption, key versioning/rotation, and deliberately limited search derivatives. Do not invent cryptography.
- Document every plaintext consumer and ensure logs, exports, queues, analytics, replicas, backups, and vendors do not recreate exposure.
- Enforce nullability, formats, enums, foreign keys, uniqueness, and monetary precision in the database.
- Parameterize values and separately allowlist dynamic identifiers.
- Wrap dependent writes in transactions; add idempotency and uniqueness for retries/webhooks; check every database result.
- Keep credentials and customer-specific data repair out of reusable migrations.
- Fix `search_path`, schema-qualify objects, constrain `EXECUTE`, validate callers, and minimize owners for privileged functions.
- Test clean installation, sequential upgrade, rollback/recovery, concurrency, and restoration.

## Public inputs and abuse

- Validate method, content type, body size, schema, types, ranges, formats, and unknown fields at the boundary.
- Bound pagination, date ranges, search complexity, uploads, decompression, row counts, and outbound fan-out.
- Rate-limit per principal and origin/IP proportionate to impact.
- Authenticate webhooks with signatures, timestamps, constant-time comparison, and replay protection.
- Use generic external errors and internal correlation IDs.
- Restrict CORS and apply browser security headers; CORS is not authentication.
- Encode output by context and prohibit unsafe HTML, command execution, and dynamic evaluation.

## Secrets, logging, and integrations

- Keep secrets in an approved manager; scan the tree and history; rotate anything committed, logged, or delivered to clients.
- Never expose service-role keys or privileged database credentials to browser code.
- Log security events without passwords, tokens, full payloads, contact details, or stable sensitive identifiers.
- Redact database/vendor failures and protect logs with access, integrity, monitoring, retention, and deletion controls.
- Inventory external recipients, data categories, purposes, credentials, timeout/retry behavior, and deletion commitments.
- Use scoped credentials, destination allowlists, TLS verification, timeouts, bounded retries with jitter, and durable outboxes where delivery matters.
- Pin dependencies/runtime imports and run vulnerability, license, provenance, and install-script checks.

## Reliability and operations

- Define one source of truth and conflict-resolution rules per entity.
- Make retryable jobs idempotent and concurrency-safe.
- Replace swallowed errors with visible state, metrics, alerts, dead letters, and reconciliation.
- Establish least-privilege production access, change approval, immutable audit events, rollback, backup/restore, incident response, and key-rotation procedures.
- Exercise restoration and incident procedures; documentation alone is not evidence.

## Privacy and compliance evidence

- With qualified counsel, identify controller/processor roles, jurisdictions, contracts, and regulated-data status.
- Maintain data-flow/subprocessor inventories, retention and deletion schedules, access reviews, incident notification, purpose limitation, consent or other lawful basis, and data-subject request handling where applicable.
- Confirm vendor agreements and safeguards before sensitive-data transfers.
- Never label a system compliant solely because it has TLS, encryption, RLS, or a compliant cloud vendor.

## Required adversarial tests

For each sensitive action test anonymous, malformed, expired, revoked, disabled, and rotated credentials; every lower role; another user's resource; another tenant; caller-supplied role/tenant overrides; direct API/database access; enumeration and brute force; oversized input and pagination abuse; replay; concurrent duplicate jobs/webhooks; partial downstream failure; and absence of sensitive data from responses/logs. Test the deployed authorization mechanism, not a mocked copy.
