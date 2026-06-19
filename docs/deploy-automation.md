# Deploy automation & merge policy

Goal: let the team (e.g. Charlie) ship the majority of changes without Will as
the bottleneck, while keeping a human gate on anything that can corrupt the
production book (schema / edge functions).

## How it works (options 2 + 3)

### 3. Branch protection + required green CI
`main` is protected. A PR can only merge when:
- the **CI checks** workflow is green (build succeeds + no hardcoded secrets), and
- required review rules (below) are satisfied.

This kills the "oops to prod" class of bugs (bad build, leaked secret) even
with light human review.

### 2. Tiered review by path
- **Safe / frontend changes** (anything NOT under `supabase/migrations/**`,
  `supabase/functions/**`, or `.github/workflows/**`): no special owner. With
  GitHub **auto-merge** enabled, these merge themselves once CI is green and a
  single teammate approval (Charlie is fine) is in — Will is not required.
- **Risky changes** (prod schema, edge functions, CI): `CODEOWNERS` requires a
  designated reviewer before merge. The `risky-paths` CI job also annotates the
  PR so it's obvious.

## One-time setup (admin)
Branch protection is applied via the GitHub API/UI (not a repo file). Recommended
settings for `main`:
- Require a pull request before merging: **on**
- Require approvals: **1**
- Require review from Code Owners: **on**  (enforces the tiered rule)
- Require status checks to pass: **on** -> select `build` and `risky-paths`
- Require branches up to date before merging: **on**
- Allow auto-merge: **on**

Then per-PR: click **Enable auto-merge**; it merges when checks + review clear.

## Day-to-day
1. Diamond (or anyone) opens a PR from a branch.
2. CI runs build + secret scan.
3. Frontend PR -> Charlie approves (or it auto-merges on green if policy allows).
4. Migration/function PR -> code owner reviews, then merge.
5. Merge to `main` -> Supabase workflow deploys backend, Netlify deploys frontend.
