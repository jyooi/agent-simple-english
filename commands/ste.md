---
description: Control writing-rule enforcement for this Claude Code session
argument-hint: on|off|status|strict|strict off
allowed-tools: Bash
disable-model-invocation: true
---

Session state:

!`cd "${CLAUDE_PLUGIN_ROOT}" && bun "src/cli/main.ts" session "${CLAUDE_SESSION_ID}" "${CLAUDE_PROJECT_DIR}" "$ARGUMENTS"`

Show the session state exactly.
Do not add text.
