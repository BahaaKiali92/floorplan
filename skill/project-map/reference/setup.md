# Setup (once per repository)

Work from the repository root. Report each step in one short line.

## 1. Check the project

- Angular project: `angular.json` exists, or `package.json` lists `@angular/core`. If not, stop: this version supports Angular only.
- `node --version` must be 18 or newer.
- `node_modules/typescript` must exist (the method analysis uses the project's own TypeScript).
  If missing, ask the user to run `npm install` first and stop.

## 2. Copy the tools into the repository

They live in the repository so CI and teammates without the skill can run them.

```bash
mkdir -p scripts/project-map
cp "<SKILL_DIR>/scripts/"* scripts/project-map/
```

If `scripts/project-map/` already existed, say "Tools updated" and show `git diff --stat scripts/project-map`.

## 3. Create `project-map.config.mjs` (only if it doesn't exist)

Start from `<SKILL_DIR>/templates/project-map.config.mjs` and adapt it:

1. `root`: read `angular.json` → `projects.<name>.sourceRoot` (usually `src`) and use `<sourceRoot>/app`.
   If the workspace has several projects, ask which one.
2. `tsconfig`: `tsconfig.json` unless the path aliases are defined in another file.
3. List the folders under `root` (two levels). Write a short `purpose` for each top-level folder from what its code does.
   Remove template entries for folders that don't exist.
4. Keep only rules that fit the real structure. If the app uses another layout (`pages/`, `modules/`, `components/`
   instead of `features/`, `shared/`, `core/`), adapt the patterns.
5. Show the proposed purposes and rules as a short list and ask the user to confirm or adjust before writing.

## 4. npm scripts

```bash
npm pkg set scripts.map="node scripts/project-map/generate-map.mjs" scripts.map:main="node scripts/project-map/generate-map.mjs --main" scripts.map:check="node scripts/project-map/generate-map.mjs --check" scripts.map:ui="node scripts/project-map/server.mjs" scripts.map:hooks="node scripts/project-map/install-hooks.mjs"
```

What they do: `map` = local map + branch report in `.project-map/` (never committed); `map:main` = the committed
main map in `docs/` (CI after merges; once now for setup); `map:check` = fails only on rule issues new compared with
main; `map:ui` = the graph; `map:hooks` = installs the automatic refresh.

## 5. CLAUDE.md

Read `<SKILL_DIR>/templates/claude-md-section.md`.
If `CLAUDE.md` has no `@docs/PROJECT_MAP.md` reference, append the section (create the file if needed).
If it already has an older "Project structure" section from this skill, replace that section with the new one.

## 6. First maps

1. `npm run map:main` creates the main map in `docs/` (from now on only CI regenerates it). Report files, routes,
   areas, and list every rule violation. Don't fix them now.
2. `npm run map` creates the local map and the branch report in `.project-map/` (the folder ignores itself).

## 7. Automatic refresh (ask first)

Ask the user whether to install the automatic refresh, then run `npm run map:hooks`. It adds:
- a Claude Code SessionStart hook in `.claude/settings.json` (commit it to share): every session starts with a short
  summary of what the branch changed compared with main;
- git hooks (post-checkout, post-merge, post-rewrite) that refresh `.project-map/` after switching branches, pulling,
  merging or rebasing. Git hooks are local to this clone; each developer runs `npm run map:hooks -- --git` once.
If the repository uses husky (`core.hooksPath`), the script prints the line to add instead of writing hooks.

## 8. CI (ask which system)

Ask which CI the repository uses and copy the matching template from `<SKILL_DIR>/templates/ci/`:
- GitHub Actions: `github-actions.yml` → `.github/workflows/project-map.yml`
- Azure Pipelines: `azure-pipelines.yml` → `azure-pipelines-project-map.yml` (the user creates a pipeline from it, or
  merges the steps into an existing pipeline)
- GitLab: show `gitlab-ci.yml` and ask before appending it to `.gitlab-ci.yml`
Each template does two jobs: pull requests run `npm run map:check` (only new issues fail); builds of main run
`npm run map:main` and commit `docs/` with `[skip ci]`. Tell the user: CI needs full git history (already set in the
templates) and permission to push to main (protected branches need an exception for the build identity).

## 9. Finish

Tell the user briefly:
- Commit: `scripts/project-map/`, `project-map.config.mjs`, `docs/PROJECT_MAP.md`, `docs/project-map.json`,
  `package.json`, `CLAUDE.md`, and if added `.claude/settings.json` and the CI file. `.project-map/` stays local.
- Merge this to main first; from then on CI keeps the main map current.
- Each teammate: `npm run map:hooks -- --git` once per clone (or just `npm run map` when they want a fresh report).
- Open the graph: `/project-map ui` (or `npm run map:ui`). It works offline: D3 is bundled.
