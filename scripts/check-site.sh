#!/usr/bin/env bash
# Checks a deployment from the outside, the way a phone sees it: the server and
# database (/api/health), the download page and the Android app. Prints a
# Markdown table and exits 1 if anything fails. Each check gets a few tries, so
# a redeploy swapping containers doesn't count as an outage.
#
#   scripts/check-site.sh https://hackathon-teamg-pausebutton-production.up.railway.app
#
# Used by .github/workflows/uptime.yml. ATTEMPTS and RETRY_DELAY (seconds) override the retries.
set -u

host="${1:?usage: scripts/check-site.sh https://<host>}"
host="${host%/}"
attempts="${ATTEMPTS:-3}"
delay="${RETRY_DELAY:-20}"
out=$(mktemp)
err=$(mktemp)
trap 'rm -f "$out" "$err"' EXIT
failed=0

# check <path> <must contain, or ""> [head]: passes on HTTP 200 (and the text, when given).
check() {
  local path="$1" contains="$2" method="${3:-get}" code="" i
  for i in $(seq 1 "$attempts"); do
    if [ "$method" = head ]; then
      code=$(curl -sS -I -o "$out" -w '%{http_code}' -m 30 "$host$path" 2>"$err")
    else
      code=$(curl -sS -o "$out" -w '%{http_code}' -m 30 "$host$path" 2>"$err")
    fi
    if [ "$code" = 200 ] && { [ -z "$contains" ] || grep -qF "$contains" "$out"; }; then
      echo "| \`$path\` | ✅ $code |"
      return
    fi
    [ "$i" -lt "$attempts" ] && sleep "$delay"
  done
  local detail
  detail=$(cat "$out" "$err" 2>/dev/null | tr -d '\r\n|`' | head -c 200)
  echo "| \`$path\` | ❌ ${code:-no answer} ${detail} |"
  failed=1
}

echo "Checked $host at $(date -u '+%Y-%m-%d %H:%M UTC')"
echo
echo "| Check | Result |"
echo "|---|---|"
check /api/health '"ok":true'
check /download "Download for Android"
check /pause-button.apk "" head
exit "$failed"
