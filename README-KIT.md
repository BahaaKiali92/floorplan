# Project Map for Claude Code (Angular)

A Claude Code skill for Angular repositories:

- **Structure map** Claude reads for every task (`docs/PROJECT_MAP.md`), with folder purposes and rules.
- **Main map + branch report**: CI regenerates the main map after every merge (no merge conflicts); on each branch a
  local report shows what the branch changed compared with main, and Claude gets a short summary at every session start.
- **Rule check** for CI (`npm run map:check`): misplaced files, forbidden imports between features. Fails only on
  issues a branch introduces, so existing problems on main don't block anyone. Compact map for large apps.
- **Bubble graph** in the browser: drill down folder by folder, see dependencies, drag files and folders
  to move them. Imports are rewritten (relative, `@aliases`, lazy routes, `templateUrl`), `git mv` keeps history,
  every move is previewed and can be undone.
- **Move methods between services (preview)**: open a service, select methods, drop them on another service or a
  folder. The TypeScript compiler finds callers, template uses, test mocks, helpers and state that move along,
  shared state, and circular dependencies. You get a precise task that Claude then carries out.

Requirements: Claude Code, Node 18+, an Angular project with `npm install` done. No other dependencies, no network
access needed (D3 is bundled).

## Documentation

| Document | Read it for |
|---|---|
| [docs/1-SETUP.md](docs/1-SETUP.md) | installing the skill (3 ways), setting up a repository, the config file, CI, updating, uninstalling, company rollout, troubleshooting |
| [docs/2-VALIDATION.md](docs/2-VALIDATION.md) | how the rules, `map:check`, move safety checks and method analysis work, exit codes, and a step-by-step check of your installation with `sample-app/` |
| [docs/3-FEATURES.md](docs/3-FEATURES.md) | every feature: skill commands, the map, the bubble graph, moving files, moving methods, CLIs, server API, limits |

Start with 1, then run the walkthrough in 2 (part B) on `sample-app/` before using a company project.

## Install on a laptop (pick one)

### A. As a personal skill (simplest)

Copy the `skill/project-map` folder into your Claude skills folder:

```bash
# macOS / Linux
mkdir -p ~/.claude/skills && cp -r skill/project-map ~/.claude/skills/

# Windows (PowerShell)
New-Item -ItemType Directory -Force "$HOME\.claude\skills" | Out-Null
Copy-Item -Recurse skill\project-map "$HOME\.claude\skills\"
```

Start a new Claude Code session. The command is `/project-map`.

To share it with everyone working in one repository instead, copy the folder to `<repo>/.claude/skills/project-map`
and commit it.

### B. As a plugin from this folder

```bash
claude plugin marketplace add ./plugin-marketplace
claude plugin install project-map@project-map-tools
```

The command is then `/project-map:project-map` (also `/project-map` when nothing else uses that name).

### C. Later: for the whole company

Push `plugin-marketplace/` to a Git repository the company can read (a company GitHub/GitLab organization is better
than a personal account). Colleagues run `/plugin marketplace add <org>/<repo>` and install `project-map@project-map-tools`.
An admin can pre-install it for everyone through managed settings (`extraKnownMarketplaces` + `enabledPlugins`).
Private repositories need git access on each machine (`gh auth login` then `gh auth setup-git`).
Bump `version` in `plugins/project-map/.claude-plugin/plugin.json` for each release.

## Use it

In an Angular repository, in Claude Code:

| Command | What happens |
|---|---|
| `/project-map setup` | Copies the tools to `scripts/project-map/`, proposes folder purposes and rules (you confirm), adds `npm run map / map:check / map:ui`, adds a section to `CLAUDE.md`, generates the first map. Once per repo. Run again to update the tools. |
| `/project-map` or `/project-map map` | Refreshes the local map and branch report; summarizes what the branch changed and the structure. |
| `/project-map ui` | Starts the bubble graph at http://localhost:4321 |
| `/project-map move <source> <target-folder>` | Moves a file or folder with all imports rewritten (dry run first). |
| `/project-map move-methods <task>` | Paste the task copied from the graph. Claude re-runs the analysis, asks you about blockers, makes the change on a branch, type-checks and runs the tests. |

Without Claude: `npm run map` (local + branch report), `npm run map:main` (CI), `npm run map:check`, `npm run map:ui`,
`npm run map:hooks`, and the CLIs in `scripts/project-map/`
(`move-cli.mjs`, `analyze-cli.mjs --list`).

## Try it safely first

- Work on a new branch. File moves in the graph change the working copy; `git checkout .` / `git reset --hard` undoes everything.
- Method moves in the graph never change code; only `/project-map move-methods` does, and only after you answer its questions.

## Known limits

- Angular only for now (Spring Boot is a planned next step).
- Relative `@use`/`@import` paths inside moved `.scss` files are not rewritten; the preview warns about them.
- Undo in the graph lasts while the server runs; after that use git.
- The rules engine is simple (`noImport`, `placement`). Projects already using Nx module boundaries or Sheriff can keep
  those as the source of truth.
