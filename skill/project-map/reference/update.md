# Update the tools in this repository

The skill/plugin was updated, but the repository still runs its own copy in `scripts/project-map/` (that copy is
what CI and teammates use). This brings the copy, the CLAUDE.md section and the config up to date. Never overwrite
`project-map.config.mjs`.

1. Versions: `cat <SKILL_DIR>/scripts/VERSION` (new) and `cat scripts/project-map/VERSION` (in the repo; missing means
   0.5.0 or older). If they are equal, say so and stop unless the user wants a re-copy.
2. Work on a branch (`git switch -c chore/update-project-map` unless the user says otherwise).
3. Copy: `cp -r "<SKILL_DIR>/scripts/." scripts/project-map/`. Show `git diff --stat scripts/project-map`.
4. CLAUDE.md section: `node scripts/project-map/claude-md.mjs` (keeps line endings, replaces only its own section;
   add `--no-ci` if the config has `ci: false` or the repo has no CI job for the map).
5. Config: compare `project-map.config.mjs` with the matching template
   (`<SKILL_DIR>/templates/project-map.config.mjs` or `project-map.config.spring.mjs`). List options and rules the
   template has and the config doesn't (e.g. `ci`, `sheriff`, style-guide rules), with one line each on what they do.
   Ask which to add; add only those.
6. Run `node scripts/project-map/generate-map.mjs` (local map) and `node scripts/project-map/generate-map.mjs --check`.
   New rules can show existing issues: they are on main too, so they don't fail the check.
7. Report: old → new version, what changed (from the diff), what the user chose for the config. Remind them that CI
   regenerates the main map after the merge (or, with `ci: false`, to run `--main` on main after merging).
   Don't commit unless asked.
