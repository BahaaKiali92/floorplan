# Move a file, class, folder or package

Arguments after `move`: `<source> <target-folder>`, both relative to the map root (`root` in `floorplan.config.mjs`;
Angular usually `src/app`, Spring Boot usually the base package folder like `src/main/java/com/acme/shop`).
`.` means the root. If the user gave full paths, strip the root prefix. If something is missing, ask for it.

1. Dry run: `node scripts/floorplan/move-cli.mjs <source> <target-folder>`
2. Show the plan briefly: files that move, imports that change, warnings.
3. If the user already asked clearly for this move, continue; otherwise ask to confirm.
4. Apply: `node scripts/floorplan/move-cli.mjs <source> <target-folder> --apply`
   (uses git mv, rewrites imports, regenerates the map).
5. Verify:
   - **Angular**: type check `npx tsc --noEmit -p tsconfig.app.json` (fall back to `tsconfig.json`). Relative
     `@use`/`@import` paths in moved `.scss` files are not rewritten: fix any the tool warned about.
   - **Spring Boot**: compile with the project's wrapper: `./mvnw -q -DskipTests compile test-compile` or
     `./gradlew compileJava compileTestJava` (fall back to `mvn` / `gradle`). Then handle every warning the tool printed:
     - text mentions of the old class or package (strings, `application.yml`, XML, `@ComponentScan`,
       `logging.level.*`): update them if they refer to the moved code;
     - package-private classes or members used across the new package boundary: make them public or move them together;
     - a bean or entity that leaves the package of the `@SpringBootApplication` class is no longer found by
       component/entity scan;
     - a move into another module needs that module's dependencies.
   - The rule check: `node scripts/floorplan/generate-map.mjs --check`.
6. Report: files moved, imports rewritten, rule issues before → after. Don't commit unless asked.
