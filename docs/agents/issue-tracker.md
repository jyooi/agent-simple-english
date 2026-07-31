# Issue Tracker

Issues for this repo live in Linear, in the **Huffman** team (key `HUF`).
The parent spec for this project is HUF-130.

## How to work with it

- Use the Linear MCP tools (`mcp__plugin_linear_linear__*`) available in agent sessions: `list_issues`, `get_issue`, `save_issue`, `list_comments`, `save_comment`.
- Create issues with `save_issue` and `team: "Huffman"`.
- Feature tickets produced from a spec get the spec issue as `parentId` and use Linear's native `blockedBy` relations for blocking edges.
- Apply triage labels by name (see `triage-labels.md`).
- GitHub (`gh`) is still used for code: branches, PRs, and CI live on GitHub. Only issue tracking lives in Linear.
