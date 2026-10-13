#!/usr/bin/env bash
# Symlink every skills/<name>/ into ~/.claude/skills so edits here are live.
# Never touches entries it did not create.
set -euo pipefail

repo=$(cd "$(dirname "$0")/.." && pwd)
dest=${CLAUDE_SKILLS_DIR:-$HOME/.claude/skills}
mkdir -p "$dest"
status=0

for src in "$repo"/skills/*/; do
  src=${src%/}
  [ -f "$src/SKILL.md" ] || continue
  name=$(basename "$src")
  link="$dest/$name"
  if [ -L "$link" ]; then
    target=$(readlink "$link")
    [ "$target" = "$src" ] && continue
    case $target in
      "$repo"/*) ln -sfn "$src" "$link"; echo "relinked $name" ;;
      *) echo "skip $name: $link already points to $target" >&2; status=1 ;;
    esac
  elif [ -e "$link" ]; then
    echo "skip $name: $link exists and is not ours" >&2
    status=1
  else
    ln -s "$src" "$link"
    echo "linked $name"
  fi
done

for link in "$dest"/*; do
  [ -L "$link" ] || continue
  case $(readlink "$link") in
    "$repo"/skills/*) [ -e "$link" ] || { rm "$link"; echo "pruned $(basename "$link")"; } ;;
  esac
done

exit $status
