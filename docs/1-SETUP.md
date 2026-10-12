# 1 · Setup

How to install the `project-map` skill on a laptop and set it up in an Angular repository.

Contents:
1. [What's in the zip](#1-whats-in-the-zip)
2. [Requirements](#2-requirements)
3. [Install the skill (choose one way)](#3-install-the-skill)
4. [Check that Claude Code sees it](#4-check-that-claude-code-sees-it)
5. [Set up a repository](#5-set-up-a-repository)
6. [What setup changes in your repository](#6-what-setup-changes-in-your-repository)
7. [The config file explained](#7-the-config-file-explained)
8. [CI and the team workflow (main map vs branches)](#8-ci-and-the-team-workflow)
9. [Update to a newer version](#9-update-to-a-newer-version)
10. [Uninstall](#10-uninstall)
11. [Later: roll out to the whole company](#11-later-roll-out-to-the-whole-company)
12. [Troubleshooting](#12-troubleshooting)

---

## 1. What's in the zip

```
project-map-kit/
  README.md                 short overview
  docs/
    1-SETUP.md              this file
    2-VALIDATION.md         how the checks work, and how to verify the installation
    3-FEATURES.md           every feature in detail
  skill/project-map/        THE SKILL (copy this folder)
    SKILL.md                entry point Claude reads; routes /project-map subcommands
    reference/              step-by-step guides Claude loads on demand (setup, ui, move, move-methods)
    scripts/                the tools (Node, no dependencies) + bundled D3 for the graph
    templates/              starting config, CLAUDE.md section, CI templates (ci/)
  plugin-marketplace/       the same skill packaged as a Claude Code plugin (optional)
  sample-app/               tiny Angular-shaped app with seeded problems, for validation
```

## 2. Requirements

| Need | Why | Check |
|---|---|---|
| Claude Code (CLI, desktop or IDE extension) | runs the skill | `claude --version` |
| Node.js 18 or newer | runs the tools | `node --version` |
| An Angular project with `npm install` done | the method analysis uses the project's own TypeScript | `ls node_modules/typescript` |
| git (recommended) | file moves use `git mv` so history is kept; undo via git | `git --version` |

No internet access is needed. Nothing is sent anywhere: the tools only read and write files in your repository,
and the graph server listens only on `127.0.0.1` (your own machine).

## 3. Install the skill

Pick **one** way.

### Way A: personal skill (recommended for testing)

Available in every repository on this laptop, only for you.

macOS / Linux:
```bash
unzip project-map-kit.zip
mkdir -p ~/.claude/skills
cp -r project-map-kit/skill/project-map ~/.claude/skills/
```

Windows (PowerShell):
```powershell
Expand-Archive project-map-kit.zip -DestinationPath .
New-Item -ItemType Directory -Force "$HOME\.claude\skills" | Out-Null
Copy-Item -Recurse project-map-kit\skill\project-map "$HOME\.claude\skills\"
```

Result: `~/.claude/skills/project-map/SKILL.md` exists. Start a **new** Claude Code session.

### Way B: project skill (for a whole team in one repository)

Everyone who opens this repository in Claude Code gets the skill.

```bash
mkdir -p .claude/skills
cp -r /path/to/project-map-kit/skill/project-map .claude/skills/
git add .claude/skills/project-map && git commit -m "Add project-map skill"
```

### Way C: plugin from the folder

Same skill, installed and versioned as a plugin.

```bash
claude plugin marketplace add ./project-map-kit/plugin-marketplace
claude plugin install project-map@project-map-tools
```

Expected output:
```
✔ Successfully added marketplace: project-map-tools (declared in user settings)
✔ Successfully installed plugin: project-map@project-map-tools (scope: user)
```

As a plugin the command is `/project-map:project-map` (Claude Code also accepts `/project-map` when no other command
has that name). Everywhere in these docs, `/project-map …` means either form.

> Don't install it both as a personal skill and as a plugin; you'd get two copies.

## 4. Check that Claude Code sees it

1. Start a new session in any folder: `claude`
2. Type `/project-` — `project-map` must appear in the suggestions, with the hint
   `[setup | map | ui [port] | move <source> <target-folder> | move-methods <task or details>]`.
3. Plugin only: `claude plugin list` shows `project-map@project-map-tools … Status: ✔ enabled`, and
   `claude plugin details project-map` lists the skill `project-map`.

Not there? See [Troubleshooting](#12-troubleshooting).

## 5. Set up a repository

Do this once per Angular repository, on a branch, then merge it to main.

```bash
cd ~/projects/your-angular-app
git switch -c chore/project-map
npm install          # if not done yet
claude
```

In Claude Code:

```
/project-map setup
```

What Claude does, step by step (from `reference/setup.md`):

1. **Checks** it's an Angular project (`angular.json` or `@angular/core`), Node ≥ 18, and `node_modules/typescript`.
   If something is missing, it stops and tells you.
2. **Copies the tools** into `scripts/project-map/`.
3. **Creates `project-map.config.mjs`** (only if it doesn't exist): finds the app folder from `angular.json`, writes a
   purpose per top-level folder, adapts the rules to your real layout, and **waits for your confirmation**.
4. **Adds npm scripts**: `map`, `map:main`, `map:check`, `map:ui`, `map:hooks`.
5. **Adds a section to `CLAUDE.md`**: Claude loads the main map in every session and knows where the branch report is.
6. **Creates the first maps**: `npm run map:main` (main map in `docs/`) and `npm run map` (local map + branch report
   in `.project-map/`). Lists the existing rule issues; doesn't fix them.
7. **Asks before installing the automatic refresh** (`npm run map:hooks`): a Claude Code session-start hook and
   git hooks. See [section 8](#8-ci-and-the-team-workflow).
8. **Asks which CI you use** and copies the matching template (GitHub Actions, Azure Pipelines, GitLab).
9. Tells you what to commit.

Review the diff, then commit and merge to main:

```bash
git add scripts/project-map project-map.config.mjs docs/PROJECT_MAP.md docs/project-map.json package.json CLAUDE.md
git add .claude/settings.json .github/workflows/project-map.yml   # if they were added
git commit -m "Add project map"
```

`.project-map/` is never committed: the folder contains its own `.gitignore`.

Manual setup without Claude:

```bash
mkdir -p scripts/project-map
cp ~/.claude/skills/project-map/scripts/* scripts/project-map/
cp ~/.claude/skills/project-map/templates/project-map.config.mjs .     # then edit it
npm pkg set scripts.map="node scripts/project-map/generate-map.mjs" \
            scripts.map:main="node scripts/project-map/generate-map.mjs --main" \
            scripts.map:check="node scripts/project-map/generate-map.mjs --check" \
            scripts.map:ui="node scripts/project-map/server.mjs" \
            scripts.map:hooks="node scripts/project-map/install-hooks.mjs"
cat ~/.claude/skills/project-map/templates/claude-md-section.md >> CLAUDE.md
npm run map:main && npm run map
npm run map:hooks                                   # optional: automatic refresh
cp ~/.claude/skills/project-map/templates/ci/github-actions.yml .github/workflows/project-map.yml   # or azure / gitlab
```

## 6. What setup changes in your repository

| Path | What it is | Committed? |
|---|---|---|
| `scripts/project-map/*` | the tools (generator, graph server + UI, move engine, method analysis, CLIs, hook installer, bundled D3) | yes, so CI and teammates without the skill can run them |
| `project-map.config.mjs` | folder purposes and rules, the only file you edit by hand | yes |
| `docs/PROJECT_MAP.md`, `docs/project-map.json` | the **main map**: structure of main, loaded by Claude | yes, but only CI updates it (after merges to main) |
| `.project-map/` | **local**: map of your working tree, branch report, cache | no, never (ignores itself) |
| `package.json` | five npm scripts | yes |
| `CLAUDE.md` | section that loads the main map and points to the branch report | yes |
| `.claude/settings.json` | session-start hook (if you chose the automatic refresh) | yes, shares it with the team |
| `.git/hooks/post-checkout`, `post-merge`, `post-rewrite` | git hooks (if chosen) | no, local to each clone |
| CI file (e.g. `.github/workflows/project-map.yml`) | PR check + main map regeneration | yes |

No dependencies are added to `package.json`.

## 7. The config file explained

`project-map.config.mjs` (all paths are relative to `root`; patterns: `*` = one folder, `**` = any depth;
a folder pattern also matches everything inside it):

```js
export default {
  root: 'src/app',                 // the Angular app folder
  tsconfig: 'tsconfig.json',       // where path aliases (@core/*, @shared/*) are defined
  output: {
    markdown: 'docs/PROJECT_MAP.md',   // main map (committed, written by CI on main)
    json: 'docs/project-map.json',
    local: '.project-map',             // local map + branch report (never committed)
  },
  baseBranch: 'main',              // what branches are compared with (origin/main if it exists, else main)
  maxFilesPerFolder: 8,            // above this, a folder shows counts instead of file names (keeps the map small)
  units: ['features/*'],           // "areas" for the dependency overview; other folders group by first segment
  ignore: ['**/*.spec.ts', '**/environments/**'],
  // scanRoot: 'src',              // optional: where imports are searched/rewritten (default: folder above root)
  // preferAliases: true,          // optional: use @alias imports when a move crosses into an aliased folder
  // compactAbove: 400,            // large apps: compact Structure section above this many files
  // compactDepth: 3, compactMaxLines: 250, compactWideFolder: 30,

  folders: {                       // purposes (and optional owners) shown in the map, graph and to Claude
    'core': { purpose: 'App-wide singletons: auth, HTTP interceptors, global services', owner: 'platform' },
    'features/*': { purpose: 'Feature area' },           // wildcard: applies to every feature folder
    'features/orders': { purpose: 'Orders', owner: 'team-orders' }, // exact path wins over wildcard
  },

  rules: [ /* see 2-VALIDATION.md for every rule option */ ],
};
```

Edit it any time, then run `npm run map`.

## 8. CI and the team workflow

### The idea

| | Main map (`docs/`) | Local map + branch report (`.project-map/`) |
|---|---|---|
| Shows | structure of **main** | your working tree, and what your branch changed compared with main |
| Written by | **CI only**, after every merge to main (`npm run map:main`) | you / the hooks (`npm run map`) |
| Committed | yes | never |
| Used by | Claude in every session (`@docs/PROJECT_MAP.md` in `CLAUDE.md`) | Claude (session-start summary + file), the graph, `map:check` |

Because only CI writes the main map, feature branches never change it, so it **never causes merge conflicts**.
When you merge or rebase main into your branch, you get the current main map automatically.

The branch report compares your working tree (including uncommitted changes) with the **branch point**: the commit
where your branch left main (`git merge-base`). So it shows only your changes, never other people's work that landed
on main in the meantime. It also tells you when main has newer commits you haven't merged yet.

### CI templates

In `skill/project-map/templates/ci/`:

| File | Put it at |
|---|---|
| `github-actions.yml` | `.github/workflows/project-map.yml` |
| `azure-pipelines.yml` | `azure-pipelines-project-map.yml`, then create a pipeline from it in Azure DevOps (or copy the steps into your existing pipeline) |
| `gitlab-ci.yml` | append to `.gitlab-ci.yml` |

Each does two jobs:

1. **Pull / merge requests**: `npm run map:check`. Fails only when the PR introduces **new** rule issues; existing
   issues on main don't block anyone. Fixed issues are reported.
2. **Builds of main** (after a merge): `npm run map:main`, then commits `docs/PROJECT_MAP.md` and
   `docs/project-map.json` with `[skip ci]` if they changed.

Requirements:
- **Full git history** in the checkout (`fetch-depth: 0` / `fetchDepth: 0` / `GIT_DEPTH: 0`, already set) so the check
  can find the branch point. Without it, the check falls back to the committed main map.
- **Permission to push to main** for the CI identity. Protected branches need an exception:
  GitHub: allow the `GITHUB_TOKEN` / a bot in the ruleset; Azure DevOps: "<Project> Build Service" needs
  *Contribute* and *Bypass policies when pushing*; GitLab: a project access token with `write_repository` in
  `PROJECT_MAP_TOKEN`. If that's not allowed, see the alternative at the bottom of the Azure template.
- No `npm install` needed: the map uses only Node.

### Automatic refresh on developer machines

`npm run map:hooks` installs both (run again any time; it never duplicates):

| Hook | When | Effect |
|---|---|---|
| Claude Code SessionStart (`.claude/settings.json`) | every new session, `/clear`, after compaction | refreshes `.project-map/` and adds a short summary to Claude's context: branch, branch point, files added/moved/deleted/modified, new/fixed rule issues |
| git post-checkout / post-merge / post-rewrite (`.git/hooks/`) | switching branches, pulling, merging, rebasing | refreshes `.project-map/` silently |

Options: `npm run map:hooks -- --claude` (only Claude), `-- --git` (only git), `-- --remove` (remove both).
Git hooks are per clone: each developer runs `npm run map:hooks -- --git` once. With husky (`core.hooksPath`), the script
prints the line to add to your husky hooks instead.

### Day to day

```bash
git switch -c feature/x        # hooks refresh .project-map/
# ... work ...
npm run map                    # optional: fresh branch report right now
npm run map:check              # what CI will say: only new issues fail
git fetch && git merge origin/main   # main map comes along, no conflicts; hooks refresh the report
```

## 9. Update to a newer version

1. Replace the skill folder (`~/.claude/skills/project-map`) with the new one, or for the plugin bump `version` in
   `plugin-marketplace/plugins/project-map/.claude-plugin/plugin.json` and run
   `claude plugin marketplace update project-map-tools`.
2. In each repository: `/project-map setup` again. It copies the new tools into `scripts/project-map/`, keeps your
   `project-map.config.mjs`, updates the `CLAUDE.md` section and npm scripts, and shows `git diff --stat scripts/project-map`.
   Commit on a branch and merge; CI then regenerates the main map with the new version.

## 10. Uninstall

- Personal skill: delete `~/.claude/skills/project-map`.
- Project skill: delete `.claude/skills/project-map` from the repository.
- Plugin: `claude plugin uninstall project-map@project-map-tools`, then `claude plugin marketplace remove project-map-tools`.
- From a repository: run `npm run map:hooks -- --remove` (hooks), then delete `scripts/project-map/`,
  `project-map.config.mjs`, `docs/PROJECT_MAP.md`, `docs/project-map.json`, `.project-map/`, the `map*` npm scripts,
  the CI file, and the "Project structure" section in `CLAUDE.md`.

## 11. Later: roll out to the whole company

1. Push `plugin-marketplace/` to a Git repository everyone can read. A company GitHub/GitLab organization is better
   than a personal account (access control, ownership when people change teams).
2. Colleagues run, in Claude Code: `/plugin marketplace add <org>/<repo>` and then `/plugin install project-map@project-map-tools`.
   Other hosts: use the full git URL (`/plugin marketplace add https://gitlab.example.com/team/plugins.git`).
3. Private repository: each machine needs git access without a password prompt
   (GitHub: `gh auth login` then `gh auth setup-git`, or an SSH key loaded in ssh-agent).
4. An admin can install it for everyone through managed settings (claude.ai admin console → Claude Code → Managed
   settings, or MDM):
   ```json
   {
     "extraKnownMarketplaces": {
       "project-map-tools": { "source": { "source": "github", "repo": "<org>/<repo>" }, "autoUpdate": true }
     },
     "enabledPlugins": { "project-map@project-map-tools": true }
   }
   ```
5. Release: bump `version` in `plugin.json` for every change you want users to receive.

## 12. Troubleshooting

| Problem | Fix |
|---|---|
| `/project-map` doesn't appear | Start a **new** session. Check the folder is exactly `~/.claude/skills/project-map/SKILL.md` (not nested twice, e.g. `project-map/project-map/`). Plugin: `claude plugin list`. |
| "TypeScript not found" | Run `npm install` in the project. The analysis uses `node_modules/typescript`. |
| "Root folder not found: src/app" | Set `root` in `project-map.config.mjs` to your app folder. |
| Graph page is blank | Open the browser console. The server serves D3 from `scripts/project-map/d3.min.js`; make sure that file was copied. |
| Port 4321 is in use | `/project-map ui 4400` or `node scripts/project-map/server.mjs --port 4400` |
| Imports with aliases aren't resolved | Make sure `tsconfig` in the config points to the file with `compilerOptions.paths`. |
| Windows: `cp` not found | Use the PowerShell commands in section 3, or Git Bash. |
| Claude Code asks permission for each tool command | Normal on first use. Allow `node scripts/project-map/*` and `npm run map*` for the project. |
| Branch report: "Branch main not found" | `git fetch origin main`, or set `baseBranch` in the config if your main branch has another name (e.g. `develop`, `master`). |
| `map:check` in CI says "no main map found" / compares with docs | The checkout has no history. Use full history (`fetch-depth: 0`). |
| CI can't push the main map ("protected branch") | Give the CI identity permission to push to main, or use the artifact alternative (Azure template, bottom). |
| Map too big for Claude in a large app | It switches to compact mode automatically above 400 files (counts per folder, 3 levels, wide folders on one line). Tune `compactAbove`, `compactDepth`, `compactMaxLines`, `compactWideFolder`. |
| Session-start summary missing | Run `npm run map:hooks -- --claude`, commit `.claude/settings.json`, start a new session. Check `node scripts/project-map/generate-map.mjs --session` prints a summary. |
