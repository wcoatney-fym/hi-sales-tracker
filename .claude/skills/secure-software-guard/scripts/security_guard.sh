#!/bin/sh
set -eu

root=${1:-.}
if ! command -v rg >/dev/null 2>&1; then
  echo "security-guard: rg is required" >&2
  exit 2
fi
if [ ! -d "$root" ]; then
  echo "security-guard: repository directory not found: $root" >&2
  exit 2
fi
cd "$root"

blockers=0
warnings=0
scan() {
  severity=$1
  label=$2
  pattern=$3
  shift 3
  matches=$(rg -l -n -i --hidden \
    -g '!node_modules/**' -g '!vendor/**' -g '!dist/**' -g '!build/**' \
    -g '!.git/**' -g '!coverage/**' -g '!*.min.js' \
    -g '!.claude/skills/secure-software-guard/**' \
    "$pattern" "$@" 2>/dev/null || true)
  if [ -n "$matches" ]; then
    count=$(printf '%s\n' "$matches" | wc -l | tr -d ' ')
    echo "[$severity] $label ($count file(s))"
    printf '%s\n' "$matches" | sed 's/^/  - /'
    if [ "$severity" = "BLOCK" ]; then blockers=$((blockers + 1)); else warnings=$((warnings + 1)); fi
  fi
}

echo "security-guard: scanning $(pwd)"
scan BLOCK "Private key material" '-----BEGIN (RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----' .
scan BLOCK "Likely plaintext password assignment or seed" '(password|passwd|pwd)[[:space:]]*[:=][[:space:]]*"[^$<{[:space:]"]{7,}"|insert[[:space:]]+into[^;]*(credential|password)' .
scan BLOCK "Anonymous unrestricted database policy" 'to[[:space:]]+(anon|public)[[:space:]]+(using|with check)[[:space:]]*\([[:space:]]*true[[:space:]]*\)|to[[:space:]]+(anon|public).*using[[:space:]]*\([[:space:]]*true[[:space:]]*\)' .
scan BLOCK "Privileged service key referenced in browser source" '(SERVICE_ROLE|service.role|private[_-]?key)' src app pages components public web frontend 2>/dev/null || true
scan BLOCK "Hard-coded webhook capability URL" 'https://(hooks\.zapier\.com|hooks\.slack\.com/services|discord(app)?\.com/api/webhooks)/[^[:space:]\"]+' .
scan WARN "JWT gateway verification disabled" 'verify_jwt[[:space:]]*=[[:space:]]*false' .
scan WARN "Wildcard CORS" 'Access-Control-Allow-Origin\"?[[:space:]]*[:=][[:space:]]*\"\*\"' .
scan WARN "Security-definer database function" 'SECURITY[[:space:]]+DEFINER' .
scan WARN "Potential browser token storage" '(localStorage|sessionStorage)\.(setItem|getItem)\([^)]*(token|session|auth)' .
scan WARN "Unsafe dynamic execution or HTML" 'dangerouslySetInnerHTML|\beval[[:space:]]*\(|new[[:space:]]+Function[[:space:]]*\(' .
scan WARN "Sensitive diagnostics" 'console\.(log|warn|error).*\b(token|password|secret|key|phone|email|policy|payload|body)\b' .
echo "security-guard: blocker categories=$blockers warning categories=$warnings"
if [ "$blockers" -gt 0 ]; then
  echo "security-guard: failed; manually review and remediate blockers" >&2
  exit 1
fi
echo "security-guard: passed built-in blockers; manual trust-boundary review remains required"
