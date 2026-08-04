# agent-simple-english

`agent-simple-english` checks rules derived from ASD-STE100 Simplified Technical English (STE) and two enabled house-style rules.
It supplies one Engine, one CLI, a pi Adapter, and a Claude Code Adapter.
The Claude Code plugin uses CLI Hook mode to enforce the same rules.

This package reports deterministic writing problems.
It does not rewrite text because an automatic rewrite can change its meaning.

## What the pi Adapter does

The pi Adapter adds its active writing rules to the model prompt before each agent turn.
It then applies the rules at three layers.

1. **Write and edit gate.**
   The extension checks prose before the `write` or `edit` tool changes a file.
   A hard violation blocks the tool.
   A soft violation gives the model a warning but lets the tool change the file.
   An edit reports only new violations, so an old violation does not block an unrelated edit.

2. **Commit-message gate.**
   The extension checks static messages in detected `git commit -m` and `git commit --message` commands.
   A hard violation blocks the command before the shell starts.
   Conventional Commit prefixes and final trailer lines do not form part of the check.
   A detected commit without an available static message fails closed.

3. **Reply check.**
   Normal mode checks each final assistant reply and shows the hard and soft counts in a widget.
   The model receives hard violation details before its next call.
   Normal mode does not hide or change the reply.
   Strict mode makes the model send each reply through the `say` tool.
   A strict reply stays hidden until it has no hard violations.

The pi Adapter checks Markdown prose and source comments according to the [content kinds](#content-kinds).
It gives the line, column, rule ID, and suggested correction for a blocked tool call.
A config, dictionary, or rule-data load error makes enabled write, edit, and commit gates fail closed.

## Install the Claude Code Adapter

Install [Claude Code](https://docs.anthropic.com/en/docs/claude-code) and [Bun](https://bun.sh) first.
Then use the standard local plugin flow:

```sh
claude plugin marketplace add jyooi/agent-simple-english
claude plugin install simple-english@agent-simple-english
```

Start a new Claude Code session after installation.
Bun installs the plugin dependencies when the first hook starts.
You do not need a global `simple-english` package or manual hook settings.
The repository supplies the local marketplace manifest.
Marketplace publication is outside this package release.

At `SessionStart`, the Adapter loads the merged config for an enabled session.
It reads the config from the session working directory and adds the active writing-rule summary to context.
The summary honors `hard`, `soft`, and `off` rule settings plus `maxSentenceWords`.

The `PreToolUse` gate checks `Write`, `Edit`, and `Bash` events.
A hard write or edit violation blocks the tool and returns its location, rule ID, and suggested correction.
The Adapter checks only new edit violations, so old prose does not block an unrelated edit.
Correct the text and retry the tool.
A clean retry succeeds.

For `Bash`, the gate checks static messages in detected `git commit` commands.
It blocks a hard violation before Git starts.
It also blocks a detected commit without a static `-m` or `--message` argument.
A compliant static message passes.
Soft violations allow the event and add warning text.

### Session controls

The `/ste` command controls the current Claude Code session.
New sessions start in enabled mode without a strict reply gate.
A change in one session does not change a parallel session.

| Command | Result |
| --- | --- |
| `/ste on` | Enable write, edit, commit, and reply checks. |
| `/ste off` | Disable all checks and leave strict mode. |
| `/ste status` | Show the mode, rule counts, and dictionary state. |
| `/ste strict` | Enable the strict reply gate and all other checks. |
| `/ste strict off` | Disable the strict reply gate and use reply feedback. |

Strict mode blocks a `Stop` event when the reply has a hard violation.
Claude Code then uses the violation details to write the reply again.
The `stop_hook_active` check stops a second block in the same rewrite loop.

Claude Code shows streamed reply text before the `Stop` hook runs.
Thus, strict mode can reject the completed reply, but it cannot redact text that Claude Code already showed.
The pi Adapter does not have this gap because its `say` tool hides strict reply text before approval.

### Reply feedback loop

In enabled non-strict mode, the `Stop` hook checks each finished assistant reply after Claude Code shows it.
It records only hard violation details in a state file for that Claude Code session.
The `Stop` hook does not block or change the reply in this mode.

At the next `UserPromptSubmit` event, the Adapter adds the pending feedback to the model context.
The feedback gives the line, column, rule ID, and suggested fix for each hard violation.
The Adapter then clears the pending feedback, so it adds each report only one time.
The session state retains the processed reply identity and ignores duplicate `Stop` events.
Clean and soft-only replies leave no pending feedback.

Each session has a separate state file under `$XDG_STATE_HOME/simple-english/sessions`.
The default state directory is `~/.local/state/simple-english/sessions`.
The file stores the session mode, reply identity, and pending feedback.
Concurrent sessions in one project do not read or clear state from another session.

## Install the pi Adapter

Install [pi](https://pi.dev) first.
Then use the pi package mechanism:

```sh
pi install npm:agent-simple-english
```

Pi records the package in its user settings and loads the extension in each session.
Pi packages run with your user permissions, so inspect third-party package code before installation.

Use the checkout without a persistent installation during development:

```sh
git clone https://github.com/jyooi/agent-simple-english.git
cd agent-simple-english
bun install
pi -e .
```

## Extension commands

The mode applies to the current pi session.
The extension starts in enabled mode without strict reply gating.
Type `/ste ` to see autocomplete suggestions for `on`, `off`, `status`, and `strict`.
The list changes to match the text that you type.

| Command | Result |
| --- | --- |
| `/ste` | Toggle all enforcement. |
| `/ste on` | Enable write, edit, commit, and reply checks. |
| `/ste off` | Disable all checks and leave strict mode. |
| `/ste status` | Show the mode, severity counts, and dictionary state. |
| `/ste strict` | Enable strict reply gating and the other checks. |
| `/ste strict on` | Enable strict reply gating and the other checks. |
| `/ste strict off` | Disable strict reply gating without changing the other checks. |

## Install and use the CLI

The standalone command needs [Bun](https://bun.sh).
Install it from the same npm package.
The package is `agent-simple-english` and the command it installs is `simple-english`:

```sh
bun add --global agent-simple-english
```

### Claude Code Hook mode

The `hook` subcommand reads one Claude Code hook event from standard input.
It writes one hook result as JSON.
A `SessionStart` event returns the active rule summary as added context.
A `PreToolUse` event applies the write, edit, and commit gates that the plugin registers.
A `Stop` event records hard reply feedback in enabled non-strict mode.
In strict mode, it blocks a reply that has hard violations.

A `UserPromptSubmit` event adds pending feedback to context and clears that feedback.
Every hook reads the current session mode before it applies a gate.
Malformed JSON returns a non-blocking error so Claude Code can continue.
The hook also allows the event when configuration, dictionary, rule-data, tagger, transcript, state, or file processing fails.
It adds warning text for these operational failures.
Observation-write failures are silent and do not change the hook output or decision.

### Review hook observations

Enabled Hook mode logs every write, edit, static commit-message, and reply lint decision to the local XDG state directory.
Observation logging is on by default, and the log includes clean allows and soft Findings.
Plain lint runs, disabled hook sessions, and the pi Adapter do not write Observations.
Set `SIMPLE_ENGLISH_OBSERVE=0` to stop observation logging.

Monthly Observation files use `$XDG_STATE_HOME/simple-english/observations/YYYY-MM.jsonl`.
The default base directory is `~/.local/state`.
Each Finding stores its offending snippet for later review.
Verdicts use the separate `$XDG_STATE_HOME/simple-english/verdicts.jsonl` file.
These global, host-local records can contain snippets, working directories, and file paths.
New state directories use mode `0700`, and new JSONL files use mode `0600`.
Each record uses one append-mode write without a lock, so concurrent hooks can safely add complete lines.

Review each unjudged Finding:

```sh
simple-english observe review
```

Press `t` for a true positive or `f` for a false positive.
Press `s` to leave a Finding unjudged or `q` to quit.
A Verdict can include an optional note.
A false positive exists only after a human records that Verdict.
The latest Verdict for a Finding wins.

Show fire counts, judged counts, and false-positive rates for each rule:

```sh
simple-english observe stats
```

The report also shows total Observations and clean allows.

### Lint files and standard input

Lint one or more files:

```sh
simple-english README.md
simple-english README.md src/cli/main.ts
```

Lint standard input when no file path is present:

```sh
printf 'Open the valve.\n' | simple-english
```

Lint a commit message with an explicit content kind:

```sh
git log -1 --format=%B | simple-english --kind commit-message
```

Request JSON output:

```sh
simple-english --json README.md
```

Use one explicit config file instead of discovered config files:

```sh
config_file="$(mktemp)"
printf '%s\n' '{"maxSentenceWords":25}' > "$config_file"
simple-english --config "$config_file" README.md
rm "$config_file"
```

The command prints each violation with its file, line, column, severity, rule ID, and message.
Exit code 0 means that no hard violation exists.
Exit code 1 means that at least one hard violation exists.
Exit code 2 means that an argument, input, or config error occurred.
Soft violations can appear with exit code 0.

### CLI flags

- `--json` writes one JSON report with `violations` and `summary` fields.
  Each violation includes its offending sentence or paragraph as `snippet`.

- `--config <path>` uses only that config file and disables config discovery.

- `--kind <kind>` sets one content kind for all inputs.
  Valid values are `prose-file`, `slash-source`, `hash-source`, and `commit-message`.
  The form `--kind=<kind>` also works.

- `--help` writes the command usage.

- `--version` writes the package version.

- The command rejects an unknown flag as an argument error.

- A path of `-` reads standard input.
  With no paths, the command also reads standard input.

### Content kinds

`prose-file` checks all prose in a file.
It is the default for standard input, extensionless paths, and file types that have no source mapping.

`slash-source` checks comments in these file types:
`.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs`, `.go`, `.rs`, `.java`, `.c`, `.h`, `.cpp`, `.hpp`, `.cc`, `.cs`, `.swift`, `.kt`, and `.scala`.

`hash-source` checks comments in these file types:
`.sh`, `.bash`, `.zsh`, `.py`, `.rb`, `.yaml`, `.yml`, `.toml`, and `.pl`.

`commit-message` checks the complete input as a commit message.

File extension matching does not depend on letter case.
Source kinds ignore comment markers inside string literals.
All kinds preserve the original line and column.
They ignore identifiers, YAML frontmatter, valid GFM tables, and fenced, indented, and inline Markdown code.

## Configuration

Configuration is an optional JSON object.
The project file is `.simple-english.json` at the repository root.
The global file is `$XDG_CONFIG_HOME/simple-english/config.json`.
If `XDG_CONFIG_HOME` is unset or not absolute, the global path is `~/.config/simple-english/config.json`.

Global and project files are deep-merged.
Global values load first, and project values have precedence.
The pi Adapter reads the project file only when pi trusts the project.
The `--config` flag uses only its named file.

Existing pi config paths remain as fallbacks.
The project fallback is `.pi/simple-english.json`.
The global fallback is `simple-english.json` in the pi agent config directory.
The default pi agent config directory is `~/.pi/agent`.
`PI_CODING_AGENT_DIR` can change that directory.

The loader reads a fallback file only when the new file at the same level is absent.

This example contains every config key and every rule:

```json
{
  "maxSentenceWords": 25,
  "exemptBlockQuotes": true,
  "approvedWordsPath": "./approved-words.json",
  "ruleDataExtensions": {
    "phrasal-verb": ["config/phrasal-verbs.json"],
    "hedging": ["config/hedging.json"],
    "marketing": ["config/marketing.json"],
    "adjectival-participle": ["config/adjectival-participles.json"]
  },
  "rules": {
    "contraction": "hard",
    "dictionary-not-approved-word": "hard",
    "hedging": "soft",
    "marketing": "soft",
    "paragraph-length": "hard",
    "phrasal-verb": "hard",
    "semicolon": "hard",
    "sentence-length": "hard",
    "verb-progressive": "hard",
    "verb-passive": "soft",
    "verb-perfect": "hard"
  }
}
```

Each rule setting accepts `hard`, `soft`, or `off`.
A hard violation fails the CLI and blocks a gated extension action.
A soft violation produces a report or warning but does not block the action.
The `off` value disables that rule.

`maxSentenceWords` must be a positive integer and has a default value of 25.
`exemptBlockQuotes` must be a boolean and has a default value of `false`.
When it is omitted or `false`, block quotes receive the same checks as other prose.
When it is `true`, CommonMark block quote content is exempt from `dictionary-not-approved-word`, `contraction`, `phrasal-verb`, `hedging`, and `marketing` checks.
All other rules continue to check block quote content.
`approvedWordsPath` selects a user-owned approved-word list.
The loader resolves a relative path from the working directory that requested the config.
This list replaces the bundled not-approved sample and any `SIMPLE_ENGLISH_DICTIONARY` replacement.
A missing, unreadable, or invalid list causes lint exit code 2.
The enabled pi Adapter gates fail closed after this error.
Claude Code Hook mode reports a warning and allows the event, as it does for other load errors.
Unknown keys, unknown rule IDs, and invalid values cause a config error.

`ruleDataExtensions` maps each list-backed data set to more JSON data files.
The loader adds entries from these files after the bundled entries.
The loader resolves relative paths from the current working directory.
Each file must use the [package dictionary data format](src/dictionary/README.md).
An `adjectival-participle` extension adds exact tagged-token forms that the progressive and passive rules allow after a form of `be`.
A lint command reports an extension load error and continues with the bundled rule data.
The enabled pi Adapter fails closed after that error, while Claude Code Hook mode allows the event and adds a warning.

## Rule reference

### Rules derived from ASD-STE100

#### `contraction`

Default: hard.
Reports apostrophe contractions such as forms that end in `n't`, `'re`, `'ve`, `'ll`, `'d`, or `'m`.
It also reports unambiguous forms that end in `'s`.

#### `dictionary-not-approved-word`

Default: hard.
Without an approved-word list, this rule reports forms from the bundled not-approved sample and supplies approved alternatives.
Part-of-speech data limits applicable sample entries when that data exists.
With an approved-word list, this rule reports each prose token that the list does not contain.
Matching uses exact surface forms without regard to case.
See [Configuration](#configuration) for list selection, precedence, and load errors.

#### `paragraph-length`

Default: hard.
Reports a prose paragraph that has more than six sentences.
Markdown block boundaries and list items start separate paragraphs.

#### `phrasal-verb`

Default: hard.
Reports listed forms and supplies their suggestion.
The bundled forms and suggestions are in [`src/dictionary/data/phrasal-verbs.json`](src/dictionary/data/phrasal-verbs.json).

Matching does not depend on letter case.
A phrase match stays on one source line.

#### `semicolon`

Default: hard.
Reports each prose semicolon and asks for two sentences.

#### `sentence-length`

Default: hard.
Reports a sentence above `maxSentenceWords`.
The default maximum is 25 words.

#### `verb-progressive`

Default: hard.
Reports a form of `be` followed by an `-ing` verb, with optional adverbs or `not` between them.

#### `verb-passive`

Default: soft.
Reports a form of `be` followed by a past participle, with optional adverbs or `not` between them.

Before either rule reports a finding, it checks the exact tagged token against the [bundled adjectival-participle allowlist](src/dictionary/data/adjectival-participles.json).
The `ruleDataExtensions.adjectival-participle` configuration extends that allowlist.

#### `verb-perfect`

Default: hard.
Reports auxiliary `have` followed by a past participle, with optional adverbs or `not` between them.

The three verb rules and applicable dictionary entries use the bundled English part-of-speech tagger.

### House-style rules

These rules define package house style.
They do not come from ASD-STE100.
The default config enables both rules.

#### `hedging`

Default: soft.
Reports the phrases in [`src/dictionary/data/hedging.json`](src/dictionary/data/hedging.json).
A phrase match stays on one source line.

#### `marketing`

Default: soft.
Reports complete listed forms from [`src/dictionary/data/marketing.json`](src/dictionary/data/marketing.json).
A multi-word form stays on one source line.
Matching does not depend on letter case, and the rule also reports the first listed single-token component of a hyphenated token.

## Dictionary and attribution

The package vendors dictionary data converted from Cameron Moore's MIT-licensed [`ctotheameron/pi-ste`](https://github.com/ctotheameron/pi-ste).
[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) records the pinned source, conversion scope, and license details.

ASD owns ASD-STE100 and limits redistribution of the official specification and dictionary.
This package does not include the official specification or the complete ASD dictionary.
Get the current official specification from the [ASD-STE100 site](https://www.asd-ste100.org/).
This project has no affiliation with or endorsement from ASD.

The package dictionary format and token rules are in [`src/dictionary/README.md`](src/dictionary/README.md).

To create an approved-word list, use your own licensed copy of the current ASD-STE100 specification.
Extract the approved words into the [package approved-word list format](src/dictionary/README.md#approved-word-list).
Follow that format's exact surface-form requirements.
Add source metadata that identifies your licensed revision and extraction record.
Repeat the extraction and update the metadata when you adopt a new licensed revision.
Keep the list private unless your license lets you distribute it.
This package does not extract, include, or distribute that data.
See [Configuration](#configuration) to select the list.

Set `SIMPLE_ENGLISH_DICTIONARY` to replace only the bundled not-approved sample.
Hook mode resolves a relative replacement path from the session working directory.
A lint command reports a replacement dictionary load error and continues with all other rules.
The enabled pi Adapter fails closed after that error.

## Development

```sh
bun install
bun run test
bun run bench:markdown
bun run lint
bun run typecheck
npm publish --dry-run
```

Actual npm publishing is a separate release action.

## License

[MIT](LICENSE)
