#!/usr/bin/env bash
# End-to-end tests for the project-map tools, on a temporary copy of sample-app/.
# Needs: node 18+, git, and TypeScript (installed into the copy with npm, or TS_PATH=/path/to/typescript).
#   ./tests/run.sh            all tests
#   KEEP=1 ./tests/run.sh     keep the temp folder for inspection
set -uo pipefail
cd "$(dirname "$0")/.."
REPO=$(pwd)
TOOLS=$REPO/skill/project-map/scripts
TMP=$(mktemp -d "${TMPDIR:-/tmp}/project-map-test-XXXX")
export GIT_AUTHOR_NAME=test GIT_AUTHOR_EMAIL=test@example.com GIT_COMMITTER_NAME=test GIT_COMMITTER_EMAIL=test@example.com
PASS=0; FAIL=0
ok()   { PASS=$((PASS + 1)); echo "  ✓ $1"; }
bad()  { FAIL=$((FAIL + 1)); echo "  ✗ $1"; [ -n "${2:-}" ] && echo "$2" | sed 's/^/      /' | head -20; }
has()  { if grep -qF -- "$2" <<<"$1"; then ok "$3"; else bad "$3" "$1"; fi; }
code() { if [ "$1" = "$2" ]; then ok "$3 (exit $1)"; else bad "$3 (expected exit $2, got $1)"; fi; }
cleanup() { [ -z "${KEEP:-}" ] && rm -rf "$TMP" || echo "kept: $TMP"; }
trap cleanup EXIT

echo "== 0. Repository consistency"
if diff -rq skill/project-map plugin/skills/project-map >/dev/null; then ok "plugin copy identical to skill/ (run scripts/sync-plugin.sh after changes)"
else bad "plugin/skills/project-map differs from skill/project-map: run scripts/sync-plugin.sh"; fi
for f in "$TOOLS"/*.mjs; do node --check "$f" 2>/dev/null && ok "syntax $(basename "$f")" || bad "syntax $(basename "$f")"; done
node -e "const h=require('fs').readFileSync('$TOOLS/ui.html','utf8');new Function(h.split('<script>')[1].split('</script>')[0])" 2>/dev/null && ok "ui.html script parses" || bad "ui.html script parses"

echo "== 1. Setup on a fresh copy of sample-app"
APP=$TMP/app
cp -r sample-app "$APP" && cd "$APP"
printf 'node_modules\n' > .gitignore
if [ -n "${TS_PATH:-}" ]; then mkdir -p node_modules && ln -s "$TS_PATH" node_modules/typescript
else npm install --silent --no-audit --no-fund >/dev/null 2>&1; fi
[ -d node_modules/typescript ] && ok "typescript available" || bad "typescript available (npm install failed? set TS_PATH)"
git init -q -b main && git add -A && git commit -qm sample
mkdir -p scripts/project-map && cp "$TOOLS"/* scripts/project-map/
cp "$REPO/skill/project-map/templates/project-map.config.mjs" .
npm pkg set scripts.map="node scripts/project-map/generate-map.mjs" scripts.map:main="node scripts/project-map/generate-map.mjs --main" \
  scripts.map:check="node scripts/project-map/generate-map.mjs --check" scripts.map:hooks="node scripts/project-map/install-hooks.mjs"
out=$(npm run -s map:main 2>&1); has "$out" "29 files · 7 routes · 7 areas · 2 violations" "main map: counts and 2 seeded violations"
out=$(npm run -s map 2>&1); has "$out" "issues: 0 new, 0 fixed, 2 existing" "local map + branch report on main"
[ -z "$(git status --porcelain .project-map)" ] && ok ".project-map/ ignores itself" || bad ".project-map/ shows up in git status"
out=$(node scripts/project-map/install-hooks.mjs 2>&1); has "$out" "SessionStart hook" "hooks installer (Claude)"; has "$out" "post-checkout" "hooks installer (git)"
node scripts/project-map/install-hooks.mjs >/dev/null 2>&1; n=$(grep -c "project-map/generate-map.mjs" .claude/settings.json); [ "$n" = 1 ] && ok "installer is idempotent (one hook entry)" || bad "installer added $n hook entries"
git add -A && git commit -qm "setup project map"

echo "== 2. Checks on main"
npm run -s map:check >/dev/null 2>&1; code $? 0 "map:check on main: existing issues don't block"
node scripts/project-map/generate-map.mjs --check --strict >/dev/null 2>&1; code $? 1 "map:check --strict fails on existing issues"

echo "== 3. Move engine"
out=$(node scripts/project-map/move-cli.mjs features/orders features/orders/ui 2>&1); code $? 1 "refuses folder into itself"; has "$out" "cannot be moved into itself" "message: into itself"
out=$(node scripts/project-map/move-cli.mjs nope.ts core 2>&1); code $? 1 "refuses missing source"
out=$(node scripts/project-map/move-cli.mjs features/customers/ui/customer-avatar shared/ui 2>&1)
has "$out" "Would move 3 file(s)" "dry run: folder with 3 companions"
has "$out" "@shared/ui/customer-avatar/customer-avatar.component" "dry run: import becomes @shared alias"
[ -d src/app/features/customers/ui/customer-avatar ] && ok "dry run changes nothing" || bad "dry run changed files"
git switch -q -c feature/test
node scripts/project-map/move-cli.mjs features/customers/ui/customer-avatar shared/ui --apply >/dev/null 2>&1; code $? 0 "apply folder move"
[ ! -d src/app/features/customers/ui ] && ok "empty folder removed" || bad "empty folder left behind"
grep -q "@shared/ui/customer-avatar/customer-avatar.component" src/app/features/orders/order-detail/order-detail.component.ts && ok "import rewritten in caller" || bad "import not rewritten"
tsc_out=$(npx --no-install tsc -p tsconfig.json 2>&1); code $? 0 "type check passes after the move"
git status --porcelain | grep -q "^R " && ok "git mv used (rename staged)" || bad "no git rename"

echo "== 4. Branch report and new-issues check"
out=$(npm run -s map:check 2>&1); code $? 0 "check passes after a fix"; has "$out" "1 fixed" "fixed issue reported"
sed -i.bak "1a import { OrdersService } from '../../orders/data-access/orders.service';" src/app/features/settings/settings-page/settings-page.component.ts
rm -f src/app/features/settings/settings-page/*.bak
out=$(npm run -s map:check 2>&1); code $? 1 "new forbidden import fails the check"
has "$out" "new: features/settings/settings-page/settings-page.component.ts imports features/orders/data-access/orders.service.ts" "new issue named"
npm run -s map >/dev/null 2>&1
rep=$(cat .project-map/BRANCH_CHANGES.md)
has "$rep" "rule issues: 1 new, 1 fixed, 1 existing" "report summary"
has "$rep" "features/customers/ui/customer-avatar/ → shared/ui/customer-avatar/ (3 files" "moves grouped per folder"
has "$rep" "features/settings → features/orders" "new area dependency"
out=$(CLAUDE_PROJECT_DIR="$APP" node "$APP/scripts/project-map/generate-map.mjs" --session); has "$out" "Rule issues introduced by this branch: 1; fixed: 1" "session summary"
out=$(cd / && CLAUDE_PROJECT_DIR=/does-not-exist node "$APP/scripts/project-map/generate-map.mjs" --session); code $? 0 "session hook never fails"
git checkout -q -- src/app/features/settings

echo "== 5. Merge + CI on main, second branch without conflicts"
git add -A && git commit -qm "move avatar to shared"
git switch -q main && git switch -q -c feature/other
node scripts/project-map/move-cli.mjs features/customers/customer-list/customer-export.service.ts features/customers/data-access --apply >/dev/null 2>&1
git add -A && git commit -qm "other: export service to data-access"
git switch -q main && git merge -q --no-ff feature/test -m "Merge feature/test"
out=$(npm run -s map:main 2>&1); has "$out" "1 violations" "CI main map after merge: 1 violation left"
git add docs && git commit -qm "chore: update project map [skip ci]"
git switch -q feature/other && git merge -q --no-edit main >/dev/null 2>&1; code $? 0 "merging main into another branch: no conflicts"
out=$(npm run -s map:check 2>&1); code $? 0 "other branch: no new issues"; has "$out" "1 fixed" "other branch: its own fix only"

echo "== 6. Method-move analysis"
out=$(node scripts/project-map/analyze-cli.mjs --source features/orders/data-access/orders.service.ts --methods exportCsv,exportPdf --target-folder features/orders/data-access --class OrderExportService 2>&1)
code $? 3 "blockers → exit 3"
has "$out" 'State "cache" is read or written by moving methods and by refresh' "shared state blocker"
has "$out" "- formatRow" "helper moves along"; has "$out" "exportCount" "state moves along"
has "$out" "order-list.component.html:2  exportPdf (template)" "template caller"
has "$out" "order-list.component.spec.ts" "spec mock"
out=$(node scripts/project-map/analyze-cli.mjs --source features/orders/data-access/orders.service.ts --methods getOrder --target-file core/http/api-base.service.ts --json 2>&1)
has "$out" "circular dependency" "cycle detected"
out=$(node scripts/project-map/analyze-cli.mjs --source features/orders/data-access/orders.service.ts --methods exportCsv --target-folder features/orders --class exporter 2>&1)
code $? 1 "bad service name refused"

echo "== 7. Compact map for large apps"
for i in $(seq 1 120); do cp -r src/app/features/orders "src/app/features/orders$i"; done
node scripts/project-map/generate-map.mjs --main --quiet
size=$(wc -c < docs/PROJECT_MAP.md)
[ "$size" -lt 20000 ] && ok "compact map small ($size bytes for $(find src/app -name '*.ts' | wc -l) files)" || bad "compact map too big ($size bytes)"
grep -q "Compact view" docs/PROJECT_MAP.md && ok "compact mode on" || bad "compact mode off"

echo
echo "Passed: $PASS   Failed: $FAIL"
[ "$FAIL" -eq 0 ]
