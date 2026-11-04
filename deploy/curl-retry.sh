#!/bin/sh
set -u

# Cabal aborts a build when its package download is cut off mid-response.
# Retry from the partial output file so interrupted large downloads can resume.
output=$(mktemp)
trap 'rm -f "$output"' EXIT HUP INT TERM
attempt=1
url=$1
shift

# Cabal's signed mirror list currently points at an HTTP mirror returning 403.
# Use the HTTPS Hackage Content endpoint for package files instead.
case "$url" in
  http://objects-us-east-1.dream.io/hackage-mirror/*)
    url="https://hackage-content.haskell.org/${url#http://objects-us-east-1.dream.io/hackage-mirror/}"
    ;;
  http://hackage.fpcomplete.com/*)
    url="https://hackage-content.haskell.org/${url#http://hackage.fpcomplete.com/}"
    ;;
esac

while :; do
  if /usr/bin/curl --continue-at - "$url" "$@" >"$output"; then
    response=$(cat "$output")
    if [ "$response" = "206" ]; then
      printf '200'
    else
      printf '%s' "$response"
    fi
    exit 0
  else
    status=$?
  fi

  if [ "$attempt" -ge 8 ]; then
    cat "$output"
    exit "$status"
  fi
  sleep "$attempt"
  attempt=$((attempt + 1))
done
