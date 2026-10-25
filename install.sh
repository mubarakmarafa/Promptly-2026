#!/usr/bin/env bash
# Installs the /promptly skill for Claude Code and Codex.
# Usage: curl -fsSL https://raw.githubusercontent.com/mubarakmarafa/Promptly-2026/main/install.sh | bash
set -euo pipefail

REPO="mubarakmarafa/Promptly-2026"
BRANCH="${PROMPTLY_BRANCH:-main}"

if [ -f "$(dirname "$0")/skills/promptly/SKILL.md" ] 2>/dev/null; then
  SRC="$(cd "$(dirname "$0")" && pwd)/skills/promptly"
else
  TMP="$(mktemp -d)"
  trap 'rm -rf "$TMP"' EXIT
  curl -fsSL "https://github.com/$REPO/archive/refs/heads/$BRANCH.tar.gz" | tar -xz -C "$TMP"
  SRC="$(echo "$TMP"/*/skills/promptly)"
fi

installed=()
for dir in "$HOME/.claude/skills" "$HOME/.codex/skills"; do
  parent="$(dirname "$dir")"
  [ -d "$parent" ] || continue
  mkdir -p "$dir"
  # The skill used to be called wrapped; remove that copy if it's ours.
  if grep -qs "How I AI" "$dir/wrapped/SKILL.md"; then rm -rf "$dir/wrapped"; fi
  rm -rf "$dir/promptly"
  cp -R "$SRC" "$dir/promptly"
  installed+=("$dir/promptly")
done

if [ ${#installed[@]} -eq 0 ]; then
  echo "Couldn't find ~/.claude or ~/.codex. Install Claude Code or Codex first." >&2
  exit 1
fi

printf 'Installed:\n'; printf '  %s\n' "${installed[@]}"
echo
echo "Claude Code: run /promptly"
echo "Codex:       run \$promptly (or ask for your Promptly)"
