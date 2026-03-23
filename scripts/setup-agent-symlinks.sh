#!/bin/bash
# setup-agent-symlinks.sh
# Creates symlinks from tool-specific config files to AGENTS.md

set -e

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

make_symlink() {
  local link="$1"
  local target="$2"

  mkdir -p "$(dirname "$link")"

  if [ -L "$link" ]; then
    rm "$link"
  elif [ -e "$link" ]; then
    return
  fi

  ln -s "$target" "$link"
}

# CLAUDE.md symlinks (one per AGENTS.md found in repo)
while IFS= read -r agents_file; do
  dir="$(dirname "$agents_file")"
  if [ "$dir" = "." ]; then
    make_symlink "CLAUDE.md" "AGENTS.md"
  else
    make_symlink "$dir/CLAUDE.md" "AGENTS.md"
  fi
done < <(git ls-files | grep "AGENTS\.md$" || true)

# GitHub Copilot
if [ -f "AGENTS.md" ]; then
  make_symlink ".github/copilot-instructions.md" "../AGENTS.md"
fi

# Cursor
if [ -f "AGENTS.md" ]; then
  make_symlink ".cursor/rules/main.mdc" "../../AGENTS.md"
fi
