#!/bin/bash
# PostToolUse hook: detect unsafe TypeScript types after Edit/Write
# Scans the modified file for: any, unknown, undefined, null type annotations
# Returns feedback to Claude so it can propose a proper fix

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')

# Skip non-TypeScript files
if [[ ! "$FILE_PATH" =~ \.(ts|tsx)$ ]]; then
  exit 0
fi

# Skip test files, declaration files, and node_modules
if [[ "$FILE_PATH" == *node_modules* ]] || \
   [[ "$FILE_PATH" == *".d.ts" ]] || \
   [[ "$FILE_PATH" == *.test.* ]] || \
   [[ "$FILE_PATH" == *.spec.* ]]; then
  exit 0
fi

# Check if file exists
if [[ ! -f "$FILE_PATH" ]]; then
  exit 0
fi

VIOLATIONS=""

# Detect `: any` — type annotations using `any`
# Matches patterns like `: any`, `: any[]`, `: any)`, `<any>`, `as any`
ANY_HITS=$(grep -nE ':\s*any\b|<any>|as any\b' "$FILE_PATH" 2>/dev/null | head -10)
if [[ -n "$ANY_HITS" ]]; then
  VIOLATIONS="${VIOLATIONS}

## \`any\` type found:
\`\`\`
${ANY_HITS}
\`\`\`"
fi

# Detect `as unknown as` — double assertion escape hatch
UNKNOWN_CAST_HITS=$(grep -nE 'as unknown as' "$FILE_PATH" 2>/dev/null | head -10)
if [[ -n "$UNKNOWN_CAST_HITS" ]]; then
  VIOLATIONS="${VIOLATIONS}

## \`as unknown as\` cast found:
\`\`\`
${UNKNOWN_CAST_HITS}
\`\`\`"
fi

# Detect `@ts-ignore` and `@ts-expect-error` — type suppression
TS_IGNORE_HITS=$(grep -nE '@ts-ignore|@ts-expect-error' "$FILE_PATH" 2>/dev/null | head -10)
if [[ -n "$TS_IGNORE_HITS" ]]; then
  VIOLATIONS="${VIOLATIONS}

## TypeScript error suppression found:
\`\`\`
${TS_IGNORE_HITS}
\`\`\`"
fi

# Detect explicit `| undefined` or `| null` in type annotations (not in value checks)
# This catches type annotations like `foo: string | undefined` but not runtime checks like `if (x === null)`
NULLABLE_HITS=$(grep -nE ':\s*[^=]*\|\s*(undefined|null)\b' "$FILE_PATH" 2>/dev/null | head -10)
if [[ -n "$NULLABLE_HITS" ]]; then
  # These are warnings, not hard blocks — nullable types are sometimes intentional
  VIOLATIONS="${VIOLATIONS}

## Explicit nullable types found (review if intentional):
\`\`\`
${NULLABLE_HITS}
\`\`\`"
fi

if [[ -z "$VIOLATIONS" ]]; then
  exit 0
fi

# Return structured feedback — Claude will see this and can act on it
cat <<EOF
{
  "hookSpecificOutput": {
    "hookEventName": "PostToolUse",
    "additionalContext": "TYPE SAFETY VIOLATION in ${FILE_PATH}:\n${VIOLATIONS}\n\nYou MUST fix these violations. Replace \`any\` with a proper type, remove \`as unknown as\` casts, and remove \`@ts-ignore\` directives. Think carefully about what the correct type should be based on the surrounding code context. Nullable types (| undefined, | null) should only be used when the value genuinely can be absent."
  }
}
EOF

exit 0
