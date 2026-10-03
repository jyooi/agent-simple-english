---
description: Control writing-rule enforcement for this Claude Code session
argument-hint: on|off|status|strict|strict off|explain
allowed-tools: Bash
disable-model-invocation: true
---

Command output:

!`cd "${CLAUDE_PLUGIN_ROOT}" && bun "src/cli/main.ts" session "${CLAUDE_SESSION_ID}" "${CLAUDE_PROJECT_DIR}" "$ARGUMENTS"`

If the output starts with "## Rewrite request", do what it asks.
Otherwise, show the output exactly.
Do not add text.
