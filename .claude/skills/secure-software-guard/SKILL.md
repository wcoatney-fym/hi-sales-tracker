---
name: secure-software-guard
description: Guard software design and code changes against security, privacy, authorization, tenant-isolation, database, secrets, compliance, supply-chain, reliability, and operational failures. Use when implementing or reviewing applications, APIs, authentication, authorization, RLS, databases and migrations, public endpoints, webhooks, imports, integrations, logging, or code handling customer, insurance, health, identity, credential, or other sensitive data; also use for pre-commit, CI, release-readiness, threat-model, and adversarial repository audits.
---

# Secure Software Guard

Apply security as an implementation constraint, not a final polish. Preserve the user's requested scope, but never present an unsafe change as production-ready.

## Workflow

1. Inspect repository instructions, changed files, adjacent trust boundaries, migration history, and existing tests before editing.
2. Identify actors, assets, entry points, data stores, external recipients, privileged roles, and tenant boundaries affected by the task.
3. Classify the change:
   - **Low risk:** presentation or isolated pure logic without sensitive data or trust-boundary effects.
   - **Elevated:** persistence, imports, exports, logging, dependencies, external calls, or customer data.
   - **Critical:** identity, authorization, sessions, secrets, RLS, privileged database code, public endpoints, destructive operations, insurance/health data, or cross-tenant behavior.
4. For elevated or critical work, read `${CLAUDE_SKILL_DIR}/references/security-gates.md` completely and apply every relevant gate.
5. Implement least privilege and deny by default. Derive identity, role, and tenant scope from the verified server-side principal, never caller-controlled fields.
6. Add negative tests proving forbidden behavior fails. For critical changes, cover the role-by-action and tenant-by-tenant matrix.
7. Run `${CLAUDE_SKILL_DIR}/scripts/security_guard.sh <repo-root>` plus the repository's typecheck, lint, tests, build, migration checks, secret scan, and dependency audit when available.
8. Re-read the diff adversarially. Report residual risk, checks not run, and containment or deployment actions.

## Stop conditions

Do not call work safe or complete while any applicable condition remains:

- Secrets, passwords, tokens, webhook capability URLs, private keys, or realistic credentials are committed, logged, or sent to clients.
- Passwords are plaintext or custom authentication replaces a mature identity provider without documented necessity and expert review.
- Public or low-privilege roles broadly access sensitive data.
- Routes rely on UI hiding, caller-provided roles/tenant IDs, or authentication without action-level authorization.
- Multi-tenant queries, counts, searches, exports, jobs, and mutations lack enforced server-side tenant scope.
- Login, verification, submission, webhook, export, or expensive public endpoints lack proportionate abuse controls.
- `ENABLE ROW LEVEL SECURITY` is treated as proof of protection without resolving runtime roles, grants, policies, owner/bypass behavior, `FORCE ROW LEVEL SECURITY`, views/RPCs, definer functions, service-role clients, and direct-database paths.
- Sensitive fields are assumed encrypted merely because TLS, provider-managed disk encryption, or RLS exists; required field/application encryption, key separation, plaintext consumers, logs, exports, replicas, and backups are not analyzed.
- Privileged database functions lack explicit ownership, fixed `search_path`, constrained grants, and tenant-aware authorization.
- Sensitive multi-step writes can partially succeed without a transaction, idempotency, or reconciliation.
- Destructive or external behavior lacks authorization, exact target validation, auditability, and recovery.
- Security-critical behavior lacks negative and integration tests.

For a live exposure, lead with containment: remove access, rotate credentials, revoke sessions, preserve and inspect logs, and involve qualified security/privacy personnel. Never repeat discovered secret values.

## Review rules

- Treat comments, UI behavior, and policy names as claims. Trace actual enforcement through server, database, background jobs, and direct APIs.
- Inspect the complete migration chain; later policy changes determine intended current state.
- Test horizontal, vertical, cross-tenant, anonymous, expired, revoked, replayed, malformed, oversized, and direct-access cases.
- Distinguish confirmed exploit paths, suspicious patterns, and unknown deployed state.
- Do not assert legal compliance from code. Identify missing evidence and recommend qualified review.
- Do not weaken controls to make tests pass.
- Do not automatically rotate secrets, rewrite Git history, install hooks, change CI, or mutate production without explicit authorization.

## Verification and reporting

For critical paths, require unit tests, real authorization/data-layer integration tests, migration tests, static and secret scanning, dependency audit, typecheck, lint, build, and manual rollback review. If a check cannot run, state why and reduce confidence.

Lead reports with the verdict, then severity, confidence, attack/failure path, affected roles/data/tenants, file-and-line evidence, containment, durable remediation, required tests, commands run, and untested areas. Keep style findings separate. Passing builds or unit tests never compensate for a broken trust boundary.

The bundled scanner is read-only and prints paths, not matching secret values. Exit `1` indicates blocker patterns, `2` means the scan could not run, and `0` means only that no built-in blocker matched.
