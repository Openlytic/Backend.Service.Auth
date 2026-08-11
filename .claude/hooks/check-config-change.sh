#!/usr/bin/env bash
# PostToolUse(Write|Edit): if a config file was touched, remind to update the instruction docs.
# Safe by design - does nothing unless a known config path was edited.

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

if echo "$FILE_PATH" | grep -qE \
  "(package\.json|tsconfig\.json|tsconfig\.build\.json|\.eslintrc.*|\.prettierrc.*|prettier\.config\.(js|json)|\.env[^/]*|src/index\.ts)$"; then
  echo "Config changed: $(basename "$FILE_PATH"). Review CLAUDE.md / .github/copilot-instructions.md - update commands, env vars, exports, or conventions if needed."
fi

exit 0
