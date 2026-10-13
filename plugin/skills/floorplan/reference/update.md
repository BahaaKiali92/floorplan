# Update the tools in this repository

The skill/plugin was updated, but the repository still runs its own copy in `scripts/floorplan/` (that copy is
what CI and teammates use). This brings the copy, the CLAUDE.md section and the config up to date. Never overwrite
`floorplan.config.mjs`.

1. Versions: `cat <SKILL_DIR>/scripts/VERSION` (new) and `cat scripts/floorplan/VERSION` (in the repo). If the repo has
   `scripts/project-map/` instead, it was set up before the rename to Floorplan (0.9 or older): do step 2a. If the
   versions are equal, say so and stop unless the user wants a re-copy.
2. Work on a branch (`git switch -c chore/update-floorplan` unless the user says otherwise).
2a. **Migrate from project-map** (only if `scripts/project-map/` exists). Show the plan, ask, then:
   - `git mv scripts/project-map scripts/floorplan` and `git mv project-map.config.mjs floorplan.config.mjs`.
   - Map files: ask whether to keep the old paths (simplest: add `output: { markdown: 'docs/PROJECT_MAP.md', json:
     'docs/project-map.json', local: '.floorplan' }` to the config) or rename them (`git mv docs/PROJECT_MAP.md
     docs/FLOORPLAN.md`, `git mv docs/project-map.json docs/floorplan.json`, and `docs/project-map-areas` →
     `docs/floorplan-areas` if it exists). Without an `output` entry, the new defaults are `docs/FLOORPLAN.md`,
     `docs/floorplan.json` and `.floorplan/`.
   - Replace `scripts/project-map/` with `scripts/floorplan/` in `package.json` scripts, CI files (`templates/ci`
     shows the current versions; the PR-comment marker is now `<!-- floorplan -->`), `.gitignore` and docs.
   - Hooks: `node scripts/floorplan/install-hooks.mjs` replaces the old entries (Claude and git hooks).
   - Delete the old local folder `.project-map/` (never committed).
   Then continue with step 3 (copy) as usual.
3. Copy: `cp -r "<SKILL_DIR>/scripts/." scripts/floorplan/`. If `.claude/skills/floorplan/` exists (skill committed for
   cloud sessions), refresh it too: `rm -rf .claude/skills/floorplan && cp -r "<SKILL_DIR>" .claude/skills/floorplan`.
   Show `git diff --stat scripts/floorplan .claude/skills/floorplan`.
4. CLAUDE.md section: `node scripts/floorplan/claude-md.mjs` (keeps line endings, replaces only its own section;
   add `--no-ci` if the config has `ci: false` or the repo has no CI job for the map).
5. Config: compare `floorplan.config.mjs` with the matching template
   (`<SKILL_DIR>/templates/floorplan.config.mjs` or `floorplan.config.spring.mjs`). List options and rules the
   template has and the config doesn't (e.g. `ci`, `sheriff`, style-guide rules), with one line each on what they do.
   Ask which to add; add only those.
5a. If CLAUDE.md has rules and `floorplan.claude-rules.json` doesn't exist (or the map says it is out of date), offer
   `/floorplan rules` (follow `<SKILL_DIR>/reference/rules.md`).
6. Run `node scripts/floorplan/generate-map.mjs` (local map) and `node scripts/floorplan/generate-map.mjs --check`.
   New rules can show existing issues: they are on main too, so they don't fail the check.
7. Report: old → new version, what changed (from the diff), what the user chose for the config. Remind them that CI
   regenerates the main map after the merge (or, with `ci: false`, to run `--main` on main after merging).
   Don't commit unless asked.
