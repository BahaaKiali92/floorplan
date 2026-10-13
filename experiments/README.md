# Experiments: does the map help?

`run.mjs` runs the same tasks with headless Claude Code twice, once in a copy of your repository **without**
floorplan (tools, config, maps, CLAUDE.md section and hooks removed) and once **with** it, and compares:

- turns, cost and time (from `claude -p --output-format json`)
- **new rule issues** (both copies are checked with the same tools and rules, compared with the starting commit)
- fixed rule issues, files created and changed
- optionally a verify command (type check, build, tests)

Your working copy is never touched: every run uses a temporary git worktree, nothing is committed.

## Run it

1. Set up floorplan in the repository and commit it (on a branch is fine).
2. Write 4–6 tasks for **your** app in a JSON file (start from `tasks.example.json` or `tasks.spring.example.json`).
   Good tasks: a new feature page, a service next to existing ones, something that should reuse existing code, a fix
   in a messy area. They should be things you'd ask Claude for anyway.
3. Try the setup without spending anything:
   ```bash
   node experiments/run.mjs --repo ../minuteview-frontend --tasks my-tasks.json --dry-run
   ```
4. Run it (3 runs per task gives numbers you can quote; 1 run for a first look):
   ```bash
   node experiments/run.mjs --repo ../minuteview-frontend --tasks my-tasks.json --runs 3 \
     --verify "npx tsc --noEmit -p tsconfig.app.json"
   ```
   Spring Boot: `--verify "./mvnw -q -DskipTests compile"` (or `./gradlew compileJava`).
5. Read `experiments/results/<date>/results.md`. The `.diff` files show exactly what Claude did in each run.

Cost: roughly tasks × runs × 2 Claude sessions. 5 tasks × 3 runs ≈ 30 sessions.

## What to look at

- **New rule issues**: the main number. Fewer with the map means Claude put things where they belong.
- **Files created**: same place in both conditions? Then the map didn't matter for that task (that's fine; the
  earlier experiment showed it matters most where the existing code is a bad example).
- **Verify**: the map must not cost correctness.
- **Turns and cost**: a small difference either way is normal; look at the totals over all runs.
