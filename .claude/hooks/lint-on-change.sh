#!/usr/bin/env bash
# PostToolUse(Write|Edit): run the repo's local ESLint on a changed TS/JS file.
# Safe by design - no-op if eslint is not installed locally.

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
echo "$FILE_PATH" | grep -qE "\.(ts|js)$" || exit 0
echo "$FILE_PATH" | grep -qE "(node_modules|build|dist|\.claude)" && exit 0

ESLINT="node_modules/.bin/eslint"
[ -x "$ESLINT" ] || exit 0

RESULT=$("$ESLINT" --quiet "$FILE_PATH" 2>&1)
if [ $? -ne 0 ]; then
  echo "ESLint issues in $(basename "$FILE_PATH"):"
  echo "$RESULT"
fi

exit 0
