# Release verification

This record captures the HUF-142 release checks from 2026-07-31.
The captured commands and output predate the npm package renames to `simple-english` and then to `agent-simple-english`.
The `simple-english` command name did not change.
The checks used Bun 1.3.14, npm 11.6.2, Node.js 24.12.0, and pi 0.83.0.

## Isolated pi package installation

The npm package did not exist in the public registry before release.
The check created the publishable tarball and gave that tarball to the npm source path in pi.
This uses the same managed npm installation flow as the documented registry command.
A new `PI_CODING_AGENT_DIR` isolated the user-scoped package settings and installation directory.

Commands:

```sh
npm pack --pack-destination .release-verification
tarball="$PWD/.release-verification/pi-simple-english-0.1.0.tgz"
export PI_CODING_AGENT_DIR="$PWD/.release-verification/pi-agent"
pi install "npm:pi-simple-english@file:$tarball"
pi list
```

The recorded output uses shell variable names in place of worktree-specific absolute paths.

Output:

```text
Installing npm:pi-simple-english@file:$tarball...

added 7 packages, and audited 8 packages in 472ms
found 0 vulnerabilities
Installed npm:pi-simple-english@file:$tarball

User packages:
  npm:pi-simple-english@file:$tarball
    $PI_CODING_AGENT_DIR/npm/node_modules/pi-simple-english
```

The installed tree contained `effect`, `wink-nlp`, and `wink-eng-lite-web-model` as runtime dependencies.
The installed manifest exposed `src/extension/index.ts` to pi and exposed `src/cli/main.ts` as the `simple-english` command.

## Pi prompt and write gate

A throwaway local OpenAI-compatible provider returned one deterministic `write` tool call.
Pi ran in JSON mode with no session file and loaded only the package from the isolated pi profile.
The local provider captured the request so the check could inspect the complete system prompt.

Command:

```sh
PI_CODING_AGENT_DIR="$PWD/.release-verification/pi-agent" \
  pi --provider release-verification --model gate-test \
  --mode json --no-session --no-context-files \
  -p 'Call the write tool once with path .release-verification/blocked.md and content: This is not permitted.'
```

Assertions and output:

```text
Simplified Technical English prompt: present
blocked.md: absent
{"type":"tool_execution_start","toolCallId":"call_gate","toolName":"write","args":{"path":".release-verification/blocked.md","content":"This isn't permitted."}}
{"type":"tool_execution_end","toolCallId":"call_gate","toolName":"write","result":{"content":[{"type":"text","text":"STE blocked write for .release-verification/blocked.md:\n- line 1, column 6 [contraction]: Do not use a contraction. Write the words in full. Found \"isn't\". Suggested fix: Write the contracted words in full."}],"details":{}},"isError":true}
```

This result proves that the clean package loaded, added its rule summary to the prompt, and blocked the violating write before file creation.

## CLI examples and README dogfood

The check installed the packed npm artifact into an isolated Bun global directory.
It then ran each command form from the README.

Output:

```text
$ simple-english README.md
exit 0
$ simple-english README.md src/cli/main.ts
exit 0
$ printf 'Open the valve.\n' | simple-english
exit 0
$ git log -1 --format=%B | simple-english --kind commit-message
exit 0
$ simple-english --json README.md
{
  "violations": [],
  "summary": {
    "total": 0,
    "hard": 0
  }
}
$ simple-english --config "$config_file" README.md
exit 0
$ printf 'Open the valve.\n' | simple-english --kind=prose-file -
exit 0
```

## npm publish dry run

Command:

```sh
npm publish --dry-run
```

Result:

```text
npm notice name: pi-simple-english
npm notice version: 0.1.0
npm notice filename: pi-simple-english-0.1.0.tgz
npm notice total files: 38
npm notice Publishing to https://registry.npmjs.org/ with tag latest and default access (dry-run)
+ pi-simple-english@0.1.0
```

The command exited with code 0.
No actual publish command ran.
