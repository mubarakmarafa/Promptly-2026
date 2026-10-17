#!/usr/bin/env bash
# Installs the /wrapped skill for Claude Code and Codex.
# Usage: curl -fsSL https://raw.githubusercontent.com/mubarakmarafa/how-i-ai/main/install.sh | bash
set -euo pipefail

REPO="mubarakmarafa/how-i-ai"
BRANCH="${HOW_I_AI_BRANCH:-main}"

if [ -f "$(dirname "$0")/skills/wrapped/SKILL.md" ] 2>/dev/null; then
  SRC="$(cd "$(dirname "$0")" && pwd)/skills/wrapped"
else
  TMP="$(mktemp -d)"
  trap 'rm -rf "$TMP"' EXIT
  curl -fsSL "https://github.com/$REPO/archive/refs/heads/$BRANCH.tar.gz" | tar -xz -C "$TMP"
  SRC="$(echo "$TMP"/*/skills/wrapped)"
fi

installed=()
for dir in "$HOME/.claude/skills" "$HOME/.codex/skills"; do
  parent="$(dirname "$dir")"
  [ -d "$parent" ] || continue
  mkdir -p "$dir"
  rm -rf "$dir/wrapped"
  cp -R "$SRC" "$dir/wrapped"
  installed+=("$dir/wrapped")
done

if [ ${#installed[@]} -eq 0 ]; then
  echo "Couldn't find ~/.claude or ~/.codex. Install Claude Code or Codex first." >&2
  exit 1
fi

printf 'Installed:\n'; printf '  %s\n' "${installed[@]}"
echo
echo "Claude Code: run /wrapped"
echo "Codex:       run \$wrapped (or ask for your AI wrapped)"
