# 1 · Setup

How to install the `floorplan` skill on a laptop and set it up in an Angular repository.
Spring Boot (Java) projects: the install is the same; the differences in setup are in [4-SPRING-BOOT.md](4-SPRING-BOOT.md).

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
floorplan-kit/
  README.md                 short overview
  docs/
    1-SETUP.md              this file
    2-VALIDATION.md         how the checks work, and how to verify the installation
    3-FEATURES.md           every feature in detail
    4-SPRING-BOOT.md        Spring Boot (Java): setup, rules, moves, method moves, walkthrough
  skill/floorplan/        THE SKILL (copy this folder)
    SKILL.md                entry point Claude reads; routes /floorplan subcommands
    reference/              step-by-step guides Claude loads on demand (setup, ui, move, move-methods)
    scripts/                the tools (Node, no dependencies) + bundled D3 for the graph
    templates/              starting config, CLAUDE.md section, CI templates (ci/)
  plugin-marketplace/       the same skill packaged as a Claude Code plugin (optional)
  sample-app/               tiny Angular-shaped app with seeded problems, for validation
  sample-spring-app/        small Spring Boot (Maven) app with seeded problems
  java-stubs/               tiny Spring/JPA/JUnit/Mockito stand-ins to compile the Spring sample with javac
```

## 2. Requirements

| Need | Why | Check |
|---|---|---|
| Claude Code (CLI, desktop or IDE extension) | runs the skill | `claude --version` |
| Node.js 18 or newer | runs the tools | `node --version` |
| An Angular project with `npm install` done | the method analysis uses the project's own TypeScript | `ls node_modules/typescript` |
| or a Spring Boot project (Maven or Gradle, Java) | nothing to install: the tools read the Java code directly | `ls src/main/java` |
| git (recommended) | file moves use `git mv` so history is kept; undo via git | `git --version` |

No internet access is needed. Nothing is sent anywhere: the tools only read and write files in your repository,
and the graph server listens only on `127.0.0.1` (your own machine).

## 3. Install the skill

Pick **one** way.

### Way A: personal skill (recommended for testing)

Available in every repository on this laptop, only for you.

macOS / Linux:
```bash
unzip floorplan-kit.zip
mkdir -p ~/.claude/skills
cp -r floorplan-kit/skill/floorplan ~/.claude/skills/
```

Windows (PowerShell):
```powershell
Expand-Archive floorplan-kit.zip -DestinationPath .
New-Item -ItemType Directory -Force "$HOME\.claude\skills" | Out-Null
Copy-Item -Recurse floorplan-kit\skill\floorplan "$HOME\.claude\skills\"
```

Result: `~/.claude/skills/floorplan/SKILL.md` exists. Start a **new** Claude Code session.

### Way B: project skill (for a whole team in one repository)

Everyone who opens this repository in Claude Code gets the skill.

```bash
mkdir -p .claude/skills
cp -r /path/to/floorplan-kit/skill/floorplan .claude/skills/
git add .claude/skills/floorplan && git commit -m "Add floorplan skill"
```

### Way C: plugin from the folder

Same skill, installed and versioned as a plugin.

```bash
claude plugin marketplace add ./floorplan-kit/plugin-marketplace
claude plugin install floorplan@floorplan
```

Expected output:
```
✔ Successfully added marketplace: floorplan (declared in user settings)
✔ Successfully installed plugin: floorplan@floorplan (scope: user)
```

As a plugin the command is `/floorplan:floorplan` (Claude Code also accepts `/floorplan` when no other command
has that name). Everywhere in these docs, `/floorplan …` means either form.

> Don't install it both as a personal skill and as a plugin; you'd get two copies.

## 4. Check that Claude Code sees it

1. Start a new session in any folder: `claude`
2. Type `/project-` — `floorplan` must appear in the suggestions, with the hint
   `[setup | map | ui [port] | move <source> <target-folder> | move-methods <task or details>]`.
3. Plugin only: `claude plugin list` shows `floorplan@floorplan … Status: ✔ enabled`, and
   `claude plugin details floorplan` lists the skill `floorplan`.

Not there? See [Troubleshooting](#12-troubleshooting).

## 5. Set up a repository

Do this once per Angular repository, on a branch, then merge it to main.

```bash
cd ~/projects/your-angular-app
git switch -c chore/floorplan
npm install          # if not done yet
claude
```

In Claude Code:

```
/floorplan setup
```

What Claude does, step by step (from `reference/setup.md`):

1. **Checks** it's an Angular project (`angular.json` or `@angular/core`), Node ≥ 18, and `node_modules/typescript`.
   If something is missing, it stops and tells you.
2. **Copies the tools** into `scripts/floorplan/`.
3. **Creates `floorplan.config.mjs`** (only if it doesn't exist): finds the app folder from `angular.json`, writes a
   purpose per top-level folder, adapts the rules to your real layout, and **waits for your confirmation**.
4. **Adds npm scripts**: `map`, `map:main`, `map:check`, `map:ui`, `map:hooks`.
5. **Adds a section to `CLAUDE.md`**: Claude loads the main map in every session and knows where the branch report is.
6. **Creates the first maps**: `npm run map:main` (main map in `docs/`) and `npm run map` (local map + branch report
   in `.floorplan/`). Lists the existing rule issues; doesn't fix them.
7. **Asks before installing the automatic refresh** (`npm run map:hooks`): a Claude Code session-start hook and
   git hooks. See [section 8](#8-ci-and-the-team-workflow).
8. **Asks which CI you use** and copies the matching template (GitHub Actions, Azure Pipelines, GitLab).
9. Tells you what to commit.

Review the diff, then commit and merge to main:

```bash
git add scripts/floorplan floorplan.config.mjs docs/FLOORPLAN.md docs/floorplan.json package.json CLAUDE.md
git add .claude/settings.json .github/workflows/floorplan.yml   # if they were added
git commit -m "Add project map"
```

`.floorplan/` is never committed: the folder contains its own `.gitignore`.

Manual setup without Claude:

```bash
mkdir -p scripts/floorplan
cp -r ~/.claude/skills/floorplan/scripts/. scripts/floorplan/
cp ~/.claude/skills/floorplan/templates/floorplan.config.mjs .     # then edit it
npm pkg set scripts.map="node scripts/floorplan/generate-map.mjs" \
            scripts.map:main="node scripts/floorplan/generate-map.mjs --main" \
            scripts.map:check="node scripts/floorplan/generate-map.mjs --check" \
            scripts.map:ui="node scripts/floorplan/server.mjs" \
            scripts.map:hooks="node scripts/floorplan/install-hooks.mjs"
cat ~/.claude/skills/floorplan/templates/claude-md-section.md >> CLAUDE.md
npm run map:main && npm run map
npm run map:hooks                                   # optional: automatic refresh
cp ~/.claude/skills/floorplan/templates/ci/github-actions.yml .github/workflows/floorplan.yml   # or azure / gitlab
```

## 6. What setup changes in your repository

| Path | What it is | Committed? |
|---|---|---|
| `scripts/floorplan/*` | the tools (generator, graph server + UI, move engine, method analysis, CLIs, hook installer, bundled D3) | yes, so CI and teammates without the skill can run them |
| `floorplan.config.mjs` | folder purposes and rules, the only file you edit by hand | yes |
| `docs/FLOORPLAN.md`, `docs/floorplan.json` | the **main map**: structure of main, loaded by Claude | yes, but only CI updates it (after merges to main) |
| `.floorplan/` | **local**: map of your working tree, branch report, cache | no, never (ignores itself) |
| `package.json` | five npm scripts | yes |
| `CLAUDE.md` | section that loads the main map and points to the branch report | yes |
| `.claude/settings.json` | session-start hook (if you chose the automatic refresh) | yes, shares it with the team |
| `.git/hooks/post-checkout`, `post-merge`, `post-rewrite` | git hooks (if chosen) | no, local to each clone |
| CI file (e.g. `.github/workflows/floorplan.yml`) | PR check + main map regeneration | yes |

No dependencies are added to `package.json`.

## 7. The config file explained

Tip: start from a **preset** (`presets: ['angular-feature-sliced']`, `angular-nx`, `spring-layered`,
`spring-hexagonal`) and add your own rules on top; `/floorplan setup` proposes one when the layout fits. Rule types,
`typeImports`, `accepted`, `budget`, `errorFrom`, `why` and `docs`: [2-VALIDATION.md, A2](2-VALIDATION.md#a2-structure-rules).
Owners in `folders` can become a CODEOWNERS file: `node scripts/floorplan/codeowners.mjs --write`.

`floorplan.config.mjs` (all paths are relative to `root`; patterns: `*` = one folder, `**` = any depth;
a folder pattern also matches everything inside it):

```js
export default {
  root: 'src/app',                 // the Angular app folder
  tsconfig: 'tsconfig.json',       // where path aliases (@core/*, @shared/*) are defined
  output: {
    markdown: 'docs/FLOORPLAN.md',   // main map (committed, written by CI on main)
    json: 'docs/floorplan.json',
    local: '.floorplan',             // local map + branch report (never committed)
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

| | Main map (`docs/`) | Local map + branch report (`.floorplan/`) |
|---|---|---|
| Shows | structure of **main** | your working tree, and what your branch changed compared with main |
| Written by | **CI only**, after every merge to main (`npm run map:main`) | you / the hooks (`npm run map`) |
| Committed | yes | never |
| Used by | Claude in every session (`@docs/FLOORPLAN.md` in `CLAUDE.md`) | Claude (session-start summary + file), the graph, `map:check` |

Because only CI writes the main map, feature branches never change it, so it **never causes merge conflicts**.
When you merge or rebase main into your branch, you get the current main map automatically.

The branch report compares your working tree (including uncommitted changes) with the **branch point**: the commit
where your branch left main (`git merge-base`). So it shows only your changes, never other people's work that landed
on main in the meantime. It also tells you when main has newer commits you haven't merged yet.

### CI templates

In `skill/floorplan/templates/ci/` (in the kit; in the repository: `plugin/skills/floorplan/templates/ci/`):

| File | Put it at |
|---|---|
| `github-actions.yml` | `.github/workflows/floorplan.yml` |
| `azure-pipelines.yml` | `azure-pipelines-floorplan.yml`, then create a pipeline from it in Azure DevOps (or copy the steps into your existing pipeline) |
| `gitlab-ci.yml` | append to `.gitlab-ci.yml` |

Each does two jobs:

1. **Pull / merge requests**: the check (`generate-map.mjs --check`). Fails only when the PR introduces **new** rule
   issues; existing issues on main don't block anyone. It also posts a **comment on the PR**: files moved, new folders,
   new dependencies between areas, new and fixed rule issues with the fix command. GitHub updates one comment per
   PR (needs `pull-requests: write`, set in the template); Azure DevOps adds a thread (the build identity needs
   *Contribute to pull requests*); GitLab posts a note when `FLOORPLAN_TOKEN` has the `api` scope.
2. **Builds of main** (after a merge): `generate-map.mjs --main`, then commits the map (the paths come from
   `generate-map.mjs --outputs`, including the area files of a split map) with `[skip ci]` if they changed.

Requirements:
- **Full git history** in the checkout (`fetch-depth: 0` / `fetchDepth: 0` / `GIT_DEPTH: 0`, already set) so the check
  can find the branch point. Without it, the check falls back to the committed main map.
- **Permission to push to main** for the CI identity. Protected branches need an exception:
  GitHub: allow the `GITHUB_TOKEN` / a bot in the ruleset; Azure DevOps: "<Project> Build Service" needs
  *Contribute* and *Bypass policies when pushing*; GitLab: a project access token with `write_repository` in
  `FLOORPLAN_TOKEN`. If that's not allowed, see the alternative at the bottom of the Azure template.
- No `npm install` needed: the map uses only Node.

### Automatic refresh on developer machines

`npm run map:hooks` installs both (run again any time; it never duplicates):

| Hook | When | Effect |
|---|---|---|
| Claude Code SessionStart (`.claude/settings.json`) | every new session, `/clear`, after compaction | refreshes `.floorplan/` and adds a short summary to Claude's context: branch, branch point, files added/moved/deleted/modified, new/fixed rule issues |
| Claude Code PostToolUse, the **edit check** (`.claude/settings.json`) | every time Claude writes or edits a `.ts` / `.java` file | if that file now breaks a rule (new compared with main), Claude is told right away, with the fix command. Takes about 0.2 s thanks to the per-file cache. Silent when the file is fine. Skip it with `--no-edit-check` |
| git post-checkout / post-merge / post-rewrite (`.git/hooks/`) | switching branches, pulling, merging, rebasing | refreshes `.floorplan/` silently |

Options: `npm run map:hooks -- --claude` (only Claude), `-- --git` (only git), `-- --remove` (remove both).
Git hooks are per clone: each developer runs `npm run map:hooks -- --git` once. With husky (`core.hooksPath`), the script
prints the line to add to your husky hooks instead.

### Day to day

```bash
git switch -c feature/x        # hooks refresh .floorplan/
# ... work ...
npm run map                    # optional: fresh branch report right now
npm run map:check              # what CI will say: only new issues fail
git fetch && git merge origin/main   # main map comes along, no conflicts; hooks refresh the report
```

## 9. Update to a newer version

1. Update the skill: copy the new `skill/floorplan` folder over the old one, or for the plugin
   `/plugin marketplace update floorplan`.
2. In each repository: `/floorplan update`. Claude compares versions (`scripts/floorplan/VERSION`), copies the new
   tools, refreshes the CLAUDE.md section (`claude-md.mjs`), lists new config options and rules from the template and
   asks which to add, then runs the map and the check. Your `floorplan.config.mjs` is never overwritten.
3. When the skill is newer than a repository's tools, any `/floorplan` command says so in one line.

### Without CI

If no CI job regenerates the main map, setup writes `ci: false` in the config. The CLAUDE.md section then says:
after merging to main, someone runs `npm run map:main` (Spring: `node scripts/floorplan/generate-map.mjs --main`)
on main and commits it. `--main` warns when it runs on another branch.

### Windows

- `CLAUDE.md` keeps its line endings (CRLF) when the section is added or updated.
- If git shows mode changes on files you didn't touch, run `git config core.fileMode false` once in that clone.
- If your repository ignores `docs/`, choose another folder for the main map in the config (`output.markdown`,
  `output.json`); setup checks this and `--main` warns about it.

## 10. Uninstall

- Personal skill: delete `~/.claude/skills/floorplan`.
- Project skill: delete `.claude/skills/floorplan` from the repository.
- Plugin: `claude plugin uninstall floorplan@floorplan`, then `claude plugin marketplace remove floorplan`.
- From a repository: run `npm run map:hooks -- --remove` (hooks), then delete `scripts/floorplan/`,
  `floorplan.config.mjs`, `docs/FLOORPLAN.md`, `docs/floorplan.json`, `.floorplan/`, the `map*` npm scripts,
  the CI file, and the "Project structure" section in `CLAUDE.md`.

## 10a. Cloud sessions (claude.ai/code)

Cloud sessions run on a fresh clone of the repository and don't install plugins (not even the ones listed in
`.claude/settings.json`). They do load what is committed: `CLAUDE.md`, the hooks in `.claude/settings.json` and skills
in `.claude/skills/`. So for teams that use cloud sessions, commit the skill once per repository (setup offers it):

```bash
mkdir -p .claude/skills && cp -r <skill folder> .claude/skills/floorplan
git add .claude/skills/floorplan && git commit -m "Add the floorplan skill for cloud sessions"
```

Then anyone opens the repository at claude.ai/code and types `/floorplan`. `/floorplan update` refreshes that copy.
The graph needs a browser on the machine that runs it, so in cloud sessions use the map, `map:check` and the move
commands; for the graph, continue the session locally (`claude --teleport`).

## 11. Later: roll out to the whole company

1. Push `plugin-marketplace/` to a Git repository everyone can read. A company GitHub/GitLab organization is better
   than a personal account (access control, ownership when people change teams).
2. Colleagues run, in Claude Code: `/plugin marketplace add <org>/<repo>` and then `/plugin install floorplan@floorplan`.
   Other hosts: use the full git URL (`/plugin marketplace add https://gitlab.example.com/team/plugins.git`).
3. Private repository: each machine needs git access without a password prompt
   (GitHub: `gh auth login` then `gh auth setup-git`, or an SSH key loaded in ssh-agent).
4. An admin can install it for everyone through managed settings (claude.ai admin console → Claude Code → Managed
   settings, or MDM):
   ```json
   {
     "extraKnownMarketplaces": {
       "floorplan": { "source": { "source": "github", "repo": "<org>/<repo>" }, "autoUpdate": true }
     },
     "enabledPlugins": { "floorplan@floorplan": true }
   }
   ```
5. Release: bump `version` in `plugin.json` for every change you want users to receive.
6. Public listing: submit the plugin to Anthropic's community marketplace (see `docs/dev/PUBLISHING.md` in the
   repository). Then anyone can install it with `/plugin marketplace add anthropics/claude-plugins-community` and
   `/plugin install floorplan@claude-community`.

## 12. Troubleshooting

| Problem | Fix |
|---|---|
| `/floorplan` doesn't appear | Start a **new** session. Check the folder is exactly `~/.claude/skills/floorplan/SKILL.md` (not nested twice, e.g. `floorplan/floorplan/`). Plugin: `claude plugin list`. |
| "TypeScript not found" | Run `npm install` in the project. The analysis uses `node_modules/typescript`. |
| "Root folder not found: src/app" | Set `root` in `floorplan.config.mjs` to your app folder. |
| Graph page is blank | Open the browser console. The server serves D3 from `scripts/floorplan/d3.min.js`; make sure that file was copied. |
| Port 4321 is in use | `/floorplan ui 4400` or `node scripts/floorplan/server.mjs --port 4400` |
| Imports with aliases aren't resolved | Make sure `tsconfig` in the config points to the file with `compilerOptions.paths`. |
| Windows: `cp` not found | Use the PowerShell commands in section 3, or Git Bash. |
| Claude Code asks permission for each tool command | Normal on first use. Allow `node scripts/floorplan/*` and `npm run map*` for the project. |
| Branch report: "Branch main not found" | `git fetch origin main`, or set `baseBranch` in the config if your main branch has another name (e.g. `develop`, `master`). |
| `map:check` in CI says "no main map found" / compares with docs | The checkout has no history. Use full history (`fetch-depth: 0`). |
| CI can't push the main map ("protected branch") | Give the CI identity permission to push to main, or use the artifact alternative (Azure template, bottom). |
| Map too big for Claude in a large app | It switches to compact mode automatically above 400 files (counts per folder, 3 levels, wide folders on one line). Tune `compactAbove`, `compactDepth`, `compactMaxLines`, `compactWideFolder`. |
| Session-start summary missing | Run `npm run map:hooks -- --claude`, commit `.claude/settings.json`, start a new session. Check `node scripts/floorplan/generate-map.mjs --session` prints a summary. |
