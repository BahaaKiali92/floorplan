# Move methods between services

Input after `move-methods` is one of:
- a task copied from the bubble graph (starts with "Move methods from …"), or
- free text naming the source service, the methods, and the target (an existing service file, or a folder plus a new class name).

## 1. Fresh analysis (always)

Never act on a pasted task alone; the code may have changed. Run the analysis yourself
(paths relative to the app root):

```bash
node scripts/project-map/analyze-cli.mjs --source <source.service.ts> --methods a,b \
  (--target-file <target.service.ts> | --target-folder <folder> --class NewNameService) --json
```

Exit code 3 means there are blockers. Unknown service file or class names: run `analyze-cli.mjs --list`.

## 2. Decisions first

Show a short summary: methods, helpers and state that move along, dependencies the target needs, call sites, test files,
dependency direction. Then for every item in `decisions`, ask the user which option to take (one question per item,
offer the listed options). Do not start editing while a blocker is undecided. If the user picks "don't move yet", stop.

## 3. Make the change

- Create a branch: `git switch -c refactor/move-<first-method>-to-<target-kebab>` (unless the user wants the current branch).
- Target service: create it (same style as the source: `@Injectable({ providedIn: 'root' })`, `inject()` vs constructor
  injection as the source does) or open the existing one.
- Move the methods, the helpers and the state listed in `movesAlong`. Do not change what they do.
- Inject the dependencies listed in `dependencies` into the target. Remove a dependency from the source only when
  `stillUsedInSource` is false and nothing else in the source uses it.
- Apply the decisions the user made (for example expose shared state as a readonly signal).
- Callers (`methods[].callers` and `templateUses`): inject the target where needed and call it instead.
  For template calls, the component must expose the target (e.g. `readonly orderExport = inject(OrderExportService)`).
- If `internalCallers` exist, the source must inject the target.
- Test files (`specMentions`): update spies/mocks to the new service.

## 4. Verify

1. `npx tsc --noEmit -p tsconfig.app.json` (fall back to `tsconfig.json`). Fix errors in what you changed.
2. Unit tests for the touched spec files. Detect the runner from `package.json`/`angular.json`:
   Karma: `npx ng test --watch=false --include=<spec>`; Jest: `npx jest <spec>`; otherwise the project's test script.
3. `npm run map` and `npm run map:check`.
4. Re-run the analysis command from step 1 on the source: the moved methods must no longer exist there.

## 5. Report

Changed files, decisions applied, check results. Don't commit unless asked.
