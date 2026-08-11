#!/usr/bin/env bash
# PostToolUse(Write|Edit): refresh the graphify knowledge graph after a src/ change.
# Safe by design - no-op instantly if graphify is not installed.

# - skip the whole hook for anyone without graphify
command -v graphify >/dev/null 2>&1 || exit 0

INPUT=$(cat)

FILE_PATH=$(printf '%s' "$INPUT" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    ti = d.get('tool_input', {})
    print(ti.get('file_path', ti.get('path', '')))
except Exception:
    pass
" 2>/dev/null)

[ -z "$FILE_PATH" ] && exit 0
echo "$FILE_PATH" | grep -qE "(node_modules|build|dist|\.claude|graphify-out)" && exit 0

# incremental, local-only (no LLM/network), detached so it never blocks the editor
if echo "$FILE_PATH" | grep -qE "src/.*\.(ts|tsx|js)$"; then
  (graphify update . >/dev/null 2>&1 &)
fi

exit 0
