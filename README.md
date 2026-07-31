# simple-english

`simple-english` checks ASD-STE100 Simplified Technical English (STE).
It supplies one Engine, one CLI, and a pi Adapter.
The [pi coding agent](https://pi.dev) can use the Adapter to enforce the same rules.

This package reports deterministic writing problems.
It does not rewrite text because an automatic rewrite can change its meaning.

## What the extension does

The extension adds its active STE rules to the model prompt before each agent turn.
It then applies the rules at three layers.

1. **Write and edit gate.**
   The extension checks prose before the `write` or `edit` tool changes a file.
   A hard violation blocks the tool.
   A soft violation gives the model a warning but lets the tool change the file.
   An edit checks only affected sentences, so an old violation does not block an unrelated edit.

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

The extension checks Markdown prose and source comments according to the [content kinds](#content-kinds).
It gives the line, column, rule ID, and suggested correction for a blocked tool call.
A config or dictionary load error makes enabled write, edit, and commit gates fail closed.

## Install the pi Adapter

Install [pi](https://pi.dev) first.
Then use the pi package mechanism:

```sh
pi install npm:simple-english
```

Pi records the package in its user settings and loads the extension in each session.
Pi packages run with your user permissions, so inspect third-party package code before installation.

Use the checkout without a persistent installation during development:

```sh
git clone https://github.com/jyooi/ste.git
cd ste
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
Install it from the same npm package:

```sh
bun add --global simple-english
```

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

- `--config <path>` uses only that config file and disables config discovery.

- `--kind <kind>` sets one content kind for all inputs.
  Valid values are `prose-file`, `slash-source`, `hash-source`, and `commit-message`.
  The form `--kind=<kind>` also works.

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
They ignore identifiers plus fenced and indented Markdown code.
Inline Markdown code is outside every rule except `semicolon`.

## Configuration

Configuration is an optional JSON object.
The project file is `.simple-english.json` at the repository root.
The global file is `$XDG_CONFIG_HOME/simple-english/config.json`.
Without `XDG_CONFIG_HOME`, the global path is `~/.config/simple-english/config.json`.

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
Unknown keys, unknown rule IDs, and invalid values cause a config error.

## Rule reference

### `contraction`

Default: hard.
Reports apostrophe contractions such as forms that end in `n't`, `'re`, `'ve`, `'ll`, `'d`, or `'m`.
It also reports unambiguous forms that end in `'s`.

### `dictionary-not-approved-word`

Default: hard.
Reports an unapproved word or phrase from the bundled dictionary and supplies approved alternatives.
Part-of-speech data limits applicable entries when that data exists.
Matching does not depend on letter case.

### `hedging`

Default: soft.
Reports these phrases: `it is important to note`, `it should be noted`, `it is worth noting`, `please note that`, `as mentioned`, `as noted above`.
A phrase match stays on one source line.

### `marketing`

Default: soft.
Reports the first listed term in each token.
Matching does not depend on letter case, and it also examines components of hyphenated tokens.

- `seamless`.
- `seamlessly`.
- `robust`.
- `powerful`.
- `cutting-edge`.
- `effortless`.
- `effortlessly`.
- `world-class`.
- `next-generation`.
- `revolutionary`.
- `blazing`.
- `lightning-fast`.
- `elegant`.
- `delightful`.
- `turnkey`.
- `best-in-class`.
- `state-of-the-art`.
- `game-changing`.
- `battle-tested`.
- `enterprise-grade`.
- `supercharge`.
- `unleash`.
- `empower`.
- `empowers`.

### `paragraph-length`

Default: hard.
Reports a prose paragraph that has more than six sentences.
Markdown block boundaries and list items start separate paragraphs.

### `phrasal-verb`

Default: hard.
Reports these forms and supplies the listed suggestion:

| Forms | Suggestion |
| --- | --- |
| `carry out`, `carries out`, `carried out`, `carrying out` | `do`. |
| `spin up`, `spins up`, `spun up`, `spinning up` | `start`. |
| `spin down`, `spins down`, `spun down`, `spinning down` | `stop`. |
| `tear down`, `tears down`, `tore down`, `torn down`, `tearing down` | `remove`. |
| `reach out`, `reaches out`, `reached out`, `reaching out` | `ask`. |
| `dive into`, `dives into`, `dived into`, `dove into`, `diving into` | `examine`. |
| `kick off`, `kicks off`, `kicked off`, `kicking off` | `start`. |
| `roll out`, `rolls out`, `rolled out`, `rolling out` | `release`. |
| `ramp up`, `ramps up`, `ramped up`, `ramping up` | `increase`. |
| `circle back`, `circles back`, `circled back`, `circling back` | `return`. |
| `drill down`, `drills down`, `drilled down`, `drilling down` | `examine`. |

Matching does not depend on letter case.
A phrase match stays on one source line.

### `semicolon`

Default: hard.
Reports each semicolon and asks for two sentences.
This rule also checks semicolons inside inline Markdown code.

### `sentence-length`

Default: hard.
Reports a sentence above `maxSentenceWords`.
The default maximum is 25 words.

### `verb-progressive`

Default: hard.
Reports a form of `be` followed by an `-ing` verb, with optional adverbs or `not` between them.

### `verb-passive`

Default: soft.
Reports a form of `be` followed by a past participle, with optional adverbs or `not` between them.

### `verb-perfect`

Default: hard.
Reports auxiliary `have` followed by a past participle, with optional adverbs or `not` between them.

The three verb rules and applicable dictionary entries use the bundled English part-of-speech tagger.

## Dictionary and attribution

The package vendors dictionary data converted from Cameron Moore's MIT-licensed [`ctotheameron/pi-ste`](https://github.com/ctotheameron/pi-ste).
[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) records the pinned source, conversion scope, and license details.

ASD owns ASD-STE100 and limits redistribution of the official specification and dictionary.
This package does not include the official specification or the complete ASD dictionary.
Get the current official specification from the [ASD-STE100 site](https://www.asd-ste100.org/).
This project has no affiliation with or endorsement from ASD.

The package dictionary format and match rules are in [`src/dictionary/README.md`](src/dictionary/README.md).
Set `SIMPLE_ENGLISH_DICTIONARY` to a replacement dictionary file if necessary.
The CLI reports a replacement dictionary load error and continues with all other rules.
The enabled extension fails closed after that error.

## Development

```sh
bun install
bun run test
bun run lint
bun run typecheck
npm publish --dry-run
```

Actual npm publishing is a separate release action.

## License

[MIT](LICENSE)
