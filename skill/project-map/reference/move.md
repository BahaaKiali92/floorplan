# Move a file or folder

Arguments after `move`: `<source> <target-folder>`, both relative to the app root (`root` in `project-map.config.mjs`,
usually `src/app`). `.` means the app root. If the user gave full paths (`src/app/...`), strip the app root prefix.
If something is missing, ask for it.

1. Dry run: `node scripts/project-map/move-cli.mjs <source> <target-folder>`
2. Show the plan briefly: files that move, imports that change, warnings.
3. If the user already asked clearly for this move, continue; otherwise ask to confirm.
4. Apply: `node scripts/project-map/move-cli.mjs <source> <target-folder> --apply`
   (uses git mv, rewrites imports, regenerates the map).
5. Verify:
   - Type check: `npx tsc --noEmit -p tsconfig.app.json` (fall back to `tsconfig.json`).
   - Relative `@use`/`@import` paths in moved `.scss` files are not rewritten: fix any the tool warned about.
   - `npm run map:check`.
6. Report: files moved, imports rewritten, rule issues before → after. Don't commit unless asked.
