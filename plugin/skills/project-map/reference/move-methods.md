# Move methods between services

Input after `move-methods` is one of:
- a task copied from the bubble graph (starts with "Move methods from …"), or
- free text naming the source service, the methods, and the target (an existing service file, or a folder plus a new class name).

Works for Angular services (`@Injectable`) and Spring beans (`@Service`, `@Component`, controllers, listeners).

## 1. Fresh analysis (always)

Never act on a pasted task alone; the code may have changed. Run the analysis yourself
(paths relative to the map root):

```bash
node scripts/project-map/analyze-cli.mjs --source <source file> --methods a,b \
  (--target-file <target file> | --target-folder <folder> --class NewNameService) --json
```

Exit code 3 means there are blockers. Unknown file or class names: run `analyze-cli.mjs --list`.

## 2. Decisions first

Show a short summary: methods, helpers and state that move along, dependencies the target needs, call sites, test files,
dependency direction. Then for every item in `decisions`, ask the user which option to take (one question per item,
offer the listed options). Do not start editing while a blocker is undecided. If the user picks "don't move yet", stop.

Spring adds these decision kinds: `proxy-self-call` (a `@Transactional`/`@Cacheable`/`@Async` method called inside the
source class changes behavior once the call goes through the proxy), `class-annotation` (class-level `@Transactional`
etc. on the source but not on the target), `interface-method` (the method belongs to an interface the source
implements), `endpoint` (an HTTP endpoint whose URL would change), `shared-constant`.

## 3. Make the change

- Create a branch: `git switch -c refactor/move-<first-method>-to-<target-kebab>` (unless the user wants the current branch).
- Target: create it in the same style as the source, or open the existing one.
  - Angular: `@Injectable({ providedIn: 'root' })`, `inject()` vs constructor injection as the source does.
  - Spring: same stereotype as the source (usually `@Service`), constructor injection (or Lombok
    `@RequiredArgsConstructor` if the source uses it), same package conventions.
- Move the methods (Spring: all overloads), the helpers and the state listed in `movesAlong`. Do not change what they do.
  Keep their annotations (`@Transactional`, `@Scheduled`, `@KafkaListener`, mappings …) unless a decision says otherwise.
- Inject the dependencies listed in `dependencies` into the target. Remove a dependency from the source only when
  `stillUsedInSource` is false and nothing else in the source uses it.
- Apply the decisions the user made.
- Callers (`methods[].callers`, and for Angular `templateUses`): inject the target where needed and call it instead.
  Angular templates need the target exposed by the component (e.g. `readonly orderExport = inject(OrderExportService)`).
- If `internalCallers` exist, the source must inject the target.
- Tests (`specMentions`): update mocks, spies, `when(...)`/`verify(...)`, `@MockBean`/`@MockitoBean` and constructor
  calls to the new class.

## 4. Verify

1. Compile:
   - Angular: `npx tsc --noEmit -p tsconfig.app.json` (fall back to `tsconfig.json`).
   - Spring: `./mvnw -q -DskipTests compile test-compile` or `./gradlew compileJava compileTestJava`.
   Fix errors in what you changed.
2. Unit tests for the touched test files:
   - Angular: detect the runner from `package.json`/`angular.json`. Karma: `npx ng test --watch=false --include=<spec>`;
     Jest: `npx jest <spec>`; otherwise the project's test script.
   - Spring: `./mvnw -q test -Dtest=<Class1>,<Class2>` or `./gradlew test --tests <Class>`.
3. `node scripts/project-map/generate-map.mjs` and `node scripts/project-map/generate-map.mjs --check`.
4. Re-run the analysis command from step 1 on the source: the moved methods must no longer exist there.

## 5. Report

Changed files, decisions applied, check results. Don't commit unless asked.
