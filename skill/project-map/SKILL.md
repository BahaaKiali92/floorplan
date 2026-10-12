---
name: project-map
description: Angular project map. Generates a structure map Claude reads for every task, checks folder/import rules, opens an interactive bubble graph to move files and folders (imports rewritten), and previews moving methods between services. Use for "/project-map setup|map|ui|move|move-methods", for questions about where code belongs or which areas depend on each other, and whenever you create, move, rename or delete files in an Angular repo that has docs/PROJECT_MAP.md.
argument-hint: "[setup | map | ui [port] | move <source> <target-folder> | move-methods <task or details>]"
---

# Project map

This skill's folder is `${CLAUDE_SKILL_DIR}`. In the reference guides, `<SKILL_DIR>` means exactly this path.
It holds `scripts/` (the tools, with a bundled copy of D3), `templates/` and `reference/` (step-by-step guides).
In the repository, the tools live in `scripts/project-map/` after setup. Always run them from the repository root.

Arguments: `$ARGUMENTS`

## Pick the subcommand

| First word of the arguments | Do this |
|---|---|
| `setup` | Read `${CLAUDE_SKILL_DIR}/reference/setup.md` and follow it. Only when the user asked for setup. |
| `map` or nothing | The **map** section below. |
| `ui` | Read `${CLAUDE_SKILL_DIR}/reference/ui.md` and follow it. Only when the user asked for it. |
| `move` | Read `${CLAUDE_SKILL_DIR}/reference/move.md` and follow it. |
| `move-methods` | Read `${CLAUDE_SKILL_DIR}/reference/move-methods.md` and follow it. |

If the skill was loaded without a slash command (you decided it is relevant), follow **Working in a mapped repo** below.

If `scripts/project-map/generate-map.mjs` is missing in the repository for anything other than `setup`,
tell the user to run `/project-map setup` first and stop.

## map

Two layers: `docs/PROJECT_MAP.md` is the structure of **main** (committed, regenerated only by CI after merges).
`.project-map/` is local and never committed: `PROJECT_MAP.md` (current working tree) and `BRANCH_CHANGES.md`
(what this branch changed compared with main: files added/moved/deleted/modified, new and fixed rule issues).

1. Run `npm run map` (or `node scripts/project-map/generate-map.mjs`). It never touches `docs/`.
2. Read `.project-map/BRANCH_CHANGES.md`, and `docs/PROJECT_MAP.md` (or `.project-map/PROJECT_MAP.md` for the
   current working tree).
3. Answer the user's question. Without a specific question, summarize: what this branch changed, rule issues it
   introduced or fixed, then the overall structure, existing rule issues and surprising area dependencies.
4. For a misplaced file, suggest the fix as a dry-run command:
   `node scripts/project-map/move-cli.mjs <source> <target-folder>`. Don't apply it unless asked.
5. Never run `npm run map:main` or edit `docs/PROJECT_MAP.md` unless the user explicitly asks (CI's job; first setup is the exception).

## Working in a mapped repo

When `docs/PROJECT_MAP.md` exists and you create, move, rename or delete files:
- Put new files where the folder purposes and rules in the map say they belong.
- Move files with `node scripts/project-map/move-cli.mjs <source> <target-folder>` (dry run), then the same with `--apply`.
  Never move Angular files by hand; the tool also moves `.html/.scss/.spec.ts` and rewrites every import.
- Afterwards run `npm run map` and `npm run map:check` (it fails only on issues this branch introduced) **in addition
  to** the usual verification (type check, tests): map:check checks structure only. Fix rule issues by moving the file
  or changing the import, not by changing a rule, unless the user asks.
- `docs/PROJECT_MAP.md` shows main; your branch's changes are in `.project-map/BRANCH_CHANGES.md`.
