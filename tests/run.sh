#!/usr/bin/env bash
# End-to-end tests for the floorplan tools, on a temporary copy of sample-app/.
# Needs: node 18+, git, and TypeScript (installed into the copy with npm, or TS_PATH=/path/to/typescript).
#   ./tests/run.sh            all tests
#   KEEP=1 ./tests/run.sh     keep the temp folder for inspection
set -uo pipefail
cd "$(dirname "$0")/.."
REPO=$(pwd)
SKILL=$REPO/plugin/skills/floorplan
TOOLS=$SKILL/scripts
TMP=$(mktemp -d "${TMPDIR:-/tmp}/floorplan-test-XXXX")
export GIT_AUTHOR_NAME=test GIT_AUTHOR_EMAIL=test@example.com GIT_COMMITTER_NAME=test GIT_COMMITTER_EMAIL=test@example.com
PASS=0; FAIL=0
LAST="(none)"
ok()   { PASS=$((PASS + 1)); LAST="$1"; echo "  ✓ $1"; }
bad()  { FAIL=$((FAIL + 1)); echo "  ✗ $1"; [ -n "${2:-}" ] && echo "$2" | sed 's/^/      /' | head -20
         # GitHub Actions: show each failure as an annotation on the run and the pull request
         # (title: %, :, comma and newlines must be escaped, or GitHub drops the annotation)
         if [ -n "${GITHUB_ACTIONS:-}" ]; then printf '::error title=%s::%s\n' "$(printf '%s' "$1" | sed -e 's/%/%25/g' -e 's/:/%3A/g' -e 's/,/%2C/g')" "$(printf '%s' "${2:-}" | head -12 | sed 's/%/%25/g' | awk 'BEGIN{ORS="%0A"} {print}')"; fi; }
# issue lines show "path:line  detail"; most checks look at the detail, so they also match with the line number removed
norm() { sed -E 's#(\.(ts|java))(:[0-9]+)(`?)( +)#\1\4 #g' <<<"$1"; }
has()  { if grep -qF -- "$2" <<<"$1" || grep -qF -- "$2" <<<"$(norm "$1")"; then ok "$3"; else bad "$3" "$1"; fi; }
code() { if [ "$1" = "$2" ]; then ok "$3 (exit $1)"; else bad "$3 (expected exit $2, got $1)"; fi; }
cleanup() {
  rc=$?
  # GitHub Actions: if the script stopped by itself (not through a failed check), say where
  if [ -n "${GITHUB_ACTIONS:-}" ] && [ "$rc" -ne 0 ] && [ "$FAIL" -eq 0 ]; then
    echo "::error title=run.sh stopped early::exit code $rc after $PASS passed checks; last passed: $LAST"
  fi
  [ -z "${KEEP:-}" ] && rm -rf "$TMP" || echo "kept: $TMP"
}
trap cleanup EXIT

echo "== 0. Repository consistency"
[ ! -e skill ] && ok "one copy of the skill (plugin/skills/floorplan)" || bad "a second skill/ folder exists again"
v=$(cat "$TOOLS/VERSION"); grep -q "\"version\": \"$v\"" plugin/.claude-plugin/plugin.json && ok "plugin.json version = scripts/VERSION ($v)" || bad "plugin.json version differs from scripts/VERSION"
grep -q "## $v " CHANGELOG.md && ok "CHANGELOG has $v" || bad "CHANGELOG has no section for $v"
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
mkdir -p scripts/floorplan && cp -r "$TOOLS"/. scripts/floorplan/
cp "$SKILL/templates/floorplan.config.mjs" .
npm pkg set scripts.map="node scripts/floorplan/generate-map.mjs" scripts.map:main="node scripts/floorplan/generate-map.mjs --main" \
  scripts.map:check="node scripts/floorplan/generate-map.mjs --check" scripts.map:hooks="node scripts/floorplan/install-hooks.mjs"
out=$(npm run -s map:main 2>&1); has "$out" "29 files · 7 routes · 7 areas · 2 violations" "main map: counts and 2 seeded violations"
out=$(npm run -s map 2>&1); has "$out" "issues: 0 new, 0 fixed, 2 existing" "local map + branch report on main"
[ -z "$(git status --porcelain .floorplan)" ] && ok ".floorplan/ ignores itself" || bad ".floorplan/ shows up in git status"
out=$(node scripts/floorplan/install-hooks.mjs 2>&1); has "$out" "SessionStart hook" "hooks installer (Claude)"; has "$out" "post-checkout" "hooks installer (git)"
node scripts/floorplan/install-hooks.mjs >/dev/null 2>&1; n=$(grep -c "floorplan/generate-map.mjs" .claude/settings.json); [ "$n" = 2 ] && ok "installer is idempotent (session + edit hook, once each)" || bad "installer added $n hook entries"
git add -A && git commit -qm "setup project map"

echo "== 2. Checks on main"
npm run -s map:check >/dev/null 2>&1; code $? 0 "map:check on main: existing issues don't block"
node scripts/floorplan/generate-map.mjs --check --strict >/dev/null 2>&1; code $? 1 "map:check --strict fails on existing issues"

echo "== 3. Move engine"
out=$(node scripts/floorplan/move-cli.mjs features/orders features/orders/ui 2>&1); code $? 1 "refuses folder into itself"; has "$out" "cannot be moved into itself" "message: into itself"
out=$(node scripts/floorplan/move-cli.mjs nope.ts core 2>&1); code $? 1 "refuses missing source"
out=$(node scripts/floorplan/move-cli.mjs features/customers/ui/customer-avatar shared/ui 2>&1)
has "$out" "Would move 3 file(s)" "dry run: folder with 3 companions"
has "$out" "@shared/ui/customer-avatar/customer-avatar.component" "dry run: import becomes @shared alias"
[ -d src/app/features/customers/ui/customer-avatar ] && ok "dry run changes nothing" || bad "dry run changed files"
git switch -q -c feature/test
node scripts/floorplan/move-cli.mjs features/customers/ui/customer-avatar shared/ui --apply >/dev/null 2>&1; code $? 0 "apply folder move"
[ ! -d src/app/features/customers/ui ] && ok "empty folder removed" || bad "empty folder left behind"
grep -q "@shared/ui/customer-avatar/customer-avatar.component" src/app/features/orders/order-detail/order-detail.component.ts && ok "import rewritten in caller" || bad "import not rewritten"
tsc_out=$(npx --no-install tsc -p tsconfig.json 2>&1); code $? 0 "type check passes after the move"
git status --porcelain | grep -q "^R " && ok "git mv used (rename staged)" || bad "no git rename"

echo "== 4. Branch report and new-issues check"
out=$(npm run -s map:check 2>&1); code $? 0 "check passes after a fix"; has "$out" "1 fixed" "fixed issue reported"
sed -i.bak "1a import { OrdersService } from '../../orders/data-access/orders.service';" src/app/features/settings/settings-page/settings-page.component.ts
rm -f src/app/features/settings/settings-page/*.bak
out=$(npm run -s map:check 2>&1); code $? 1 "new forbidden import fails the check"
has "$out" "new: src/app/features/settings/settings-page/settings-page.component.ts imports features/orders/data-access/orders.service.ts" "new issue named"
npm run -s map >/dev/null 2>&1
rep=$(cat .floorplan/BRANCH_CHANGES.md)
has "$rep" "rule issues: 1 new, 1 fixed, 1 existing" "report summary"
has "$rep" "features/customers/ui/customer-avatar/ → shared/ui/customer-avatar/ (3 files" "moves grouped per folder"
has "$rep" "features/settings → features/orders" "new area dependency"
out=$(CLAUDE_PROJECT_DIR="$APP" node "$APP/scripts/floorplan/generate-map.mjs" --session); has "$out" "Rule issues introduced by this branch: 1; fixed: 1" "session summary"
out=$(cd / && CLAUDE_PROJECT_DIR=/does-not-exist node "$APP/scripts/floorplan/generate-map.mjs" --session); code $? 0 "session hook never fails"
git checkout -q -- src/app/features/settings

echo "== 5. Merge + CI on main, second branch without conflicts"
git add -A && git commit -qm "move avatar to shared"
git switch -q main && git switch -q -c feature/other
node scripts/floorplan/move-cli.mjs features/customers/customer-list/customer-export.service.ts features/customers/data-access --apply >/dev/null 2>&1
git add -A && git commit -qm "other: export service to data-access"
git switch -q main && git merge -q --no-ff feature/test -m "Merge feature/test"
out=$(npm run -s map:main 2>&1); has "$out" "1 violations" "CI main map after merge: 1 violation left"
git add docs && git commit -qm "chore: update project map [skip ci]"
git switch -q feature/other && git merge -q --no-edit main >/dev/null 2>&1; code $? 0 "merging main into another branch: no conflicts"
out=$(npm run -s map:check 2>&1); code $? 0 "other branch: no new issues"; has "$out" "1 fixed" "other branch: its own fix only"

echo "== 6. Method-move analysis"
out=$(node scripts/floorplan/analyze-cli.mjs --source features/orders/data-access/orders.service.ts --methods exportCsv,exportPdf --target-folder features/orders/data-access --class OrderExportService 2>&1)
code $? 3 "blockers → exit 3"
has "$out" 'State "cache" is read or written by moving methods and by refresh' "shared state blocker"
has "$out" "- formatRow" "helper moves along"; has "$out" "exportCount" "state moves along"
has "$out" "order-list.component.html:2  exportPdf (template)" "template caller"
has "$out" "order-list.component.spec.ts" "spec mock"
out=$(node scripts/floorplan/analyze-cli.mjs --source features/orders/data-access/orders.service.ts --methods getOrder --target-file core/http/api-base.service.ts --json 2>&1)
has "$out" "circular dependency" "cycle detected"
out=$(node scripts/floorplan/analyze-cli.mjs --source features/orders/data-access/orders.service.ts --methods exportCsv --target-folder features/orders --class exporter 2>&1)
code $? 1 "bad service name refused"

echo "== 7. Compact map for large apps"
for i in $(seq 1 120); do cp -r src/app/features/orders "src/app/features/orders$i"; done
node scripts/floorplan/generate-map.mjs --main --quiet
size=$(wc -c < docs/FLOORPLAN.md)
[ "$size" -lt 20000 ] && ok "compact map small ($size bytes for $(find src/app -name '*.ts' | wc -l) files)" || bad "compact map too big ($size bytes)"
grep -q "Compact view" docs/FLOORPLAN.md && ok "compact mode on" || bad "compact mode off"

echo "== 8. Spring Boot (Java): map, rules, branch report"
SP=$TMP/spring
cp -r "$REPO/sample-spring-app" "$SP" && cd "$SP"
git init -q -b main && git add -A && git commit -qm sample
mkdir -p scripts/floorplan && cp -r "$TOOLS"/. scripts/floorplan/
cp "$SKILL/templates/floorplan.config.spring.mjs" floorplan.config.mjs
G="node scripts/floorplan/generate-map.mjs"
out=$($G --main 2>&1); has "$out" "16 files · 7 endpoints · 6 areas · 6 violations" "main map: counts and 6 seeded issues"
md=$(cat docs/FLOORPLAN.md)
has "$md" "Spring Boot (Java) · 16 source files · 2 test files" "map header: framework and test count"
has "$md" "| GET /api/orders/{id} | OrderController.get() |" "HTTP endpoint with class-level @RequestMapping"
has "$md" "| KAFKA payments.failed | OrderEventsListener.onPaymentFailed() |" "Kafka listener listed"
has "$md" "orders/OrderController.java\` imports orders/OrderRepository.java — controllers-use-services" "kind rule: controller → repository"
has "$md" "shared/OrderPricingService.java\` must be in orders or customers or notifications — services-in-features" "placement by kind"
has "$md" "! \`customers/CustomerController.java\` imports customers/Customer.java — controllers-return-dtos" "warning: entity in controller"
has "$md" "- notifications → orders" "area dependency from a listener"
JAVAC=$(command -v javac || true)
compile() { if [ -z "$JAVAC" ]; then ok "$1 (javac not installed, skipped)"; return; fi
  rm -rf "$TMP/classes" && mkdir -p "$TMP/classes"
  if javac -d "$TMP/classes" $(find "$REPO/tests/java-stubs" src -name '*.java') >/dev/null 2>&1; then ok "$1"; else bad "$1" "$(javac -d "$TMP/classes" $(find "$REPO/tests/java-stubs" src -name '*.java') 2>&1 | grep -v JAVA_TOOL | head -8)"; fi; }
compile "sample compiles before any move"
$G >/dev/null 2>&1; git add -A && git commit -qm "setup project map"
$G --check >/dev/null 2>&1; code $? 0 "check on main: existing issues don't block"

echo "== 9. Spring Boot: moving classes and packages"
git switch -q -c feature/java
out=$(node scripts/floorplan/move-cli.mjs shared/OrderPricingService.java orders 2>&1)
has "$out" "package com.acme.shop.shared; → package com.acme.shop.orders;" "dry run: package declaration"
has "$out" "import com.acme.shop.orders.Order; → (removed: same package now)" "dry run: import becomes same-package"
has "$out" "(added) → import com.acme.shop.shared.Money;" "dry run: import added for the class left behind"
node scripts/floorplan/move-cli.mjs shared/OrderPricingService.java orders --apply >/dev/null 2>&1; code $? 0 "apply class move"
compile "compiles after moving a class"
out=$($G --check 2>&1); code $? 0 "check passes after the fix"; has "$out" "2 fixed" "both issues of the misplaced service fixed"
out=$(node scripts/floorplan/move-cli.mjs orders/OrderService.java customers --apply 2>&1)
has "$out" "src/test/java/com/acme/shop/customers/OrderServiceTest.java" "test class moves along"
compile "compiles after moving a class used without imports (same package)"
grep -q "^import com.acme.shop.customers.OrderService;" src/main/java/com/acme/shop/orders/OrderController.java && ok "import added where the class was used implicitly" || bad "import not added"
out=$($G --check 2>&1); code $? 1 "moving a service next to a foreign repository: new issues fail"
git reset -q --hard && git clean -qfd src
node scripts/floorplan/move-cli.mjs customers orders --apply >/dev/null 2>&1; code $? 0 "apply package move"
[ -f src/main/java/com/acme/shop/orders/customers/CustomerService.java ] && [ ! -d src/main/java/com/acme/shop/customers ] && ok "package moved, old folder removed" || bad "package move layout"
compile "compiles after moving a package"
git reset -q --hard && git clean -qfd src
mkdir -p src/main/resources && printf 'logging:\n  level:\n    com.acme.shop.orders: DEBUG\n' > src/main/resources/application.yml
printf 'package com.acme.shop.orders;\n\nclass OrderNumbers {\n    static String format(Long id) { return "ORD-" + id; }\n}\n' > src/main/java/com/acme/shop/orders/OrderNumbers.java
sed -i.bak 's|return toDto(load(id));|OrderNumbers.format(id);\n        return toDto(load(id));|' src/main/java/com/acme/shop/orders/OrderService.java && rm -f src/main/java/com/acme/shop/orders/*.bak
out=$(node scripts/floorplan/move-cli.mjs orders/OrderService.java customers 2>&1)
has "$out" "OrderNumbers is package-private" "warning: package-private class"
out=$(node scripts/floorplan/move-cli.mjs orders customers 2>&1)
has "$out" "application.yml:3 mentions com.acme.shop.orders as text" "warning: package named in application.yml"
git reset -q --hard && git clean -qfd src
out=$(node --input-type=module -e "
  const d = (await import('node:url')).pathToFileURL(process.cwd() + '/scripts/floorplan/').href; // file:// URL: plain paths fail on Windows
  const { makeContext } = await import(d + 'lib.mjs'); const { planMove, applyPlan, planUndo } = await import(d + 'move.mjs');
  const { execSync } = await import('node:child_process');
  const ctx = await makeContext(); let bad = 0;
  for (const [s, t] of [['orders/OrderService.java', 'customers'], ['orders', 'customers'], ['shared/Money.java', 'orders'], ['orders/OrderDto.java', 'shared']]) {
    const r = planMove(ctx, s, t); applyPlan(ctx, r.plan);
    applyPlan(ctx, planUndo(ctx, r.plan.pairs.map(({ from, to }) => ({ from, to }))).plan);
    if (execSync('git status --porcelain src', { encoding: 'utf8' })) { bad++; console.log('not restored: ' + s); }
    execSync('git reset -q --hard && git clean -qfd src');
  }
  console.log(bad ? 'undo failed' : 'undo restores everything');" 2>&1)
has "$out" "undo restores everything" "undo restores every file exactly (4 moves)"

echo "== 10. Spring Boot: method-move analysis"
out=$(node scripts/floorplan/analyze-cli.mjs --list 2>&1); has "$out" "OrderService  (orders/OrderService.java)" "beans listed"
out=$(node scripts/floorplan/analyze-cli.mjs --source orders/OrderService.java --methods exportCsv --target-folder orders --class OrderExportService 2>&1)
code $? 3 "blockers → exit 3"
has "$out" 'State "exportCount" is read or written by moving methods and by stats' "shared state blocker"
has "$out" "- formatCsvRow" "private helper moves along"; has "$out" "- lastExportAt" "field moves along"
has "$out" "- OrderRepository (add it to the constructor)" "dependency for the target"
has "$out" "orders/OrderController.java:39  exportCsv" "caller through an injected field"
has "$out" "OrderControllerTest.java" "test with Mockito when/verify"
has "$out" "customerName() is also used by toDto" "shared helper decision"
out=$(node scripts/floorplan/analyze-cli.mjs --source orders/OrderService.java --methods cancel --target-file customers/CustomerService.java --json 2>&1)
has "$out" "OrderEventsListener.java" "caller in a Kafka listener"
sed -i.bak 's|    public String stats() {|    public String stats() {\n        cancel(0L);|' src/main/java/com/acme/shop/orders/OrderService.java && rm -f src/main/java/com/acme/shop/orders/*.bak
out=$(node scripts/floorplan/analyze-cli.mjs --source orders/OrderService.java --methods cancel --target-file customers/CustomerService.java 2>&1)
has "$out" "has @Transactional and is called by stats inside OrderService" "Spring proxy self-call decision"
git checkout -q -- src
out=$(node scripts/floorplan/analyze-cli.mjs --source orders/OrderController.java --methods export --target-file customers/CustomerController.java 2>&1)
has "$out" "is an HTTP endpoint" "endpoint URL decision"

echo "== 11. Spring Boot: multi-module, root '.'"
MM=$TMP/multi
mkdir -p "$MM/core/src/main/java/com/acme/core/service" "$MM/api/src/main/java/com/acme/api/web" && cd "$MM"
echo '<project><modules><module>core</module><module>api</module></modules></project>' > pom.xml
printf 'package com.acme.core.service;\n\nimport org.springframework.stereotype.Service;\n\n@Service\npublic class InvoiceService {\n    public long total(long id) { return id; }\n}\n' > core/src/main/java/com/acme/core/service/InvoiceService.java
printf 'package com.acme.api.web;\n\nimport com.acme.core.service.InvoiceService;\nimport org.springframework.web.bind.annotation.*;\n\n@RestController\n@RequestMapping("/api/invoices")\npublic class InvoiceController {\n    private final InvoiceService invoiceService;\n    public InvoiceController(InvoiceService s) { this.invoiceService = s; }\n    @GetMapping("/{id}")\n    public long get(@PathVariable("id") long id) { return invoiceService.total(id); }\n}\n' > api/src/main/java/com/acme/api/web/InvoiceController.java
mkdir -p "$MM/core/src/main/java/com/acme/core/common" "$MM/api/src/main/java/com/acme/api/rest"
printf 'package com.acme.core.common;\n\nimport org.springframework.stereotype.Service;\n\n@Service\npublic @interface UseCase {}\n' > core/src/main/java/com/acme/core/common/UseCase.java
printf 'package com.acme.core.service;\n\nimport com.acme.core.common.UseCase;\n\n@UseCase\nclass PayInvoice {\n    void pay(long id) {}\n}\n' > core/src/main/java/com/acme/core/service/PayInvoice.java
printf 'package com.acme.api.rest;\n\nimport jakarta.ws.rs.*;\n\n@Path("/v1/invoices")\npublic class InvoiceResource {\n    @GET\n    @Path("{id}")\n    public String get(@PathParam("id") long id) { return ""; }\n    @POST\n    public void create() {}\n}\n' > api/src/main/java/com/acme/api/rest/InvoiceResource.java
printf "export default { framework: 'spring', root: '.' };\n" > floorplan.config.mjs
mkdir -p scripts/floorplan && cp -r "$TOOLS"/. scripts/floorplan/ && git init -q -b main && git add -A && git commit -qm init
out=$(node scripts/floorplan/generate-map.mjs --main 2>&1); has "$out" "5 files · 3 endpoints · 2 areas" "multi-module map"
has "$(cat docs/FLOORPLAN.md)" "| GET /v1/invoices/{id} | InvoiceResource.get() |" "JAX-RS endpoint"
has "$(cat docs/FLOORPLAN.md)" "services: InvoiceService, PayInvoice" "custom stereotype (@UseCase meta-annotated with @Service)"
has "$(cat docs/FLOORPLAN.md)" "- core/src/main/java/com/acme/core/" "single-child package chain on one line"
out=$(node scripts/floorplan/move-cli.mjs core/src/main/java/com/acme/core/service/InvoiceService.java api/src/main/java/com/acme/api/web 2>&1)
has "$out" "moves to another module (api)" "warning: move into another module"

echo "== 12. Angular: style guide rules, component-scoped services, Angular 20 names, near misses"
NG=$TMP/ng2
cp -r "$REPO/sample-app" "$NG" && cd "$NG"
printf 'node_modules\n' > .gitignore
mkdir -p node_modules && ln -s "$APP/node_modules/typescript" node_modules/typescript
mkdir -p scripts/floorplan && cp -r "$TOOLS"/. scripts/floorplan/ && cp "$SKILL/templates/floorplan.config.mjs" .
git init -q -b main && git add -A && git commit -qm sample
G="node scripts/floorplan/generate-map.mjs"
out=$($G --main 2>&1); has "$out" "29 files · 7 routes · 7 areas · 2 violations" "style-guide rules add nothing on a clean sample"
has "$(cat docs/FLOORPLAN.md)" "(floorplan $(cat "$TOOLS/VERSION"))" "map header shows the tool version"
git add -A && git commit -qm map && git switch -q -c feature/style
# component-scoped service: listed in providers next to its component → accepted by services-placement
sed -i.bak "s#  templateUrl: './customer-list.component.html',#  templateUrl: './customer-list.component.html',\n  providers: [CustomerExportService],#" src/app/features/customers/customer-list/customer-list.component.ts && rm -f src/app/features/customers/customer-list/*.bak
out=$($G --check 2>&1); has "$out" "fixed: features/customers/customer-list/customer-export.service.ts must be in" "component-scoped service accepted (allowComponentScoped)"
# Angular 20 style: no suffix in file names → kinds from decorators
mkdir -p src/app/features/orders/order-summary
printf "import { Component } from '@angular/core';\n@Component({ selector: 'app-order-summary', standalone: true, template: '' })\nexport class OrderSummary {}\n" > src/app/features/orders/order-summary/order-summary.ts
printf "import { Injectable } from '@angular/core';\n@Injectable({ providedIn: 'root' })\nexport class OrderTotals {}\n" > src/app/features/orders/order-summary/order-totals.ts
printf "import { CanActivateFn } from '@angular/router';\nexport const adminGuard: CanActivateFn = () => true;\n" > src/app/core/auth/admin.ts
$G >/dev/null 2>&1
kinds=$(node -e "const d=require('./.floorplan/floorplan.json');console.log(d.files.filter(f=>/order-summary\/|auth\/admin/.test(f.path)).map(f=>f.name+':'+f.kind).join(' '))")
has "$kinds" "order-summary:component" "Angular 20 file name: component from @Component"
has "$kinds" "order-totals:service" "Angular 20 file name: service from @Injectable"
has "$kinds" "admin:guard" "functional guard (CanActivateFn)"
out=$($G --check 2>&1); has "$out" "features/orders/order-summary/order-totals.ts must be in core or features/*/data-access" "placement by kind works without .service suffix"
# near miss: util/ vs utils/
mkdir -p src/app/shared/util
printf "export const sum = (a: number, b: number) => a + b;\n" > src/app/shared/util/sum.ts
cat > floorplan.config.mjs.extra <<'JS'
JS
node -e "
const fs=require('fs');let c=fs.readFileSync('floorplan.config.mjs','utf8');
c=c.replace(\"  rules: [\", \"  rules: [\n    { name: 'helpers-in-utils', type: 'placement', files: 'shared/**', kinds: ['other'], allowedIn: ['**/utils', 'shared/ui', 'shared/pipes', 'shared/directives'], message: 'Helpers live in a utils/ folder.' },\n    { name: 'naming-test', type: 'naming', case: 'kebab', message: 'kebab' },\");
fs.writeFileSync('floorplan.config.mjs',c);"
rm -f floorplan.config.mjs.extra
printf "export const x = 1;\n" > src/app/shared/ui/MyHelper.ts
out=$($G --check 2>&1)
has "$out" '(folder "util/": did you mean "utils/"?)' "near-miss hint for util/ vs utils/"
has "$out" 'file name "MyHelper" is not kebab-case' "naming rule"
printf "import { Component, Injectable } from '@angular/core';\n@Injectable()\nexport class A {}\n@Component({ selector: 'x', template: '' })\nexport class B {}\n" > src/app/shared/ui/two-things.ts
out=$($G 2>&1); has "$(cat .floorplan/FLOORPLAN.md)" "shared/ui/two-things.ts\` declares 2 Angular classes — one-angular-class-per-file" "one declaration per file"
git checkout -q -- . && git clean -qfd src

echo "== 13. Angular: public API rule and Sheriff"
printf "export { CustomerAvatarComponent } from './ui/customer-avatar/customer-avatar.component';\n" > src/app/features/customers/index.ts
out=$($G 2>&1); has "$(cat .floorplan/FLOORPLAN.md)" "features/orders/order-detail/order-detail.component.ts\` imports features/customers/ui/customer-avatar/customer-avatar.component.ts — feature-public-api" "deep import into a feature with an index.ts"
rm -f src/app/features/customers/index.ts
if [ -n "${SHERIFF_PKG:-}" ] && [ -d "$SHERIFF_PKG" ]; then
  mkdir -p node_modules/@softarc && cp -r "$SHERIFF_PKG" node_modules/@softarc/sheriff-core
  printf "import { appConfig } from './app/app.config';\nimport { AppComponent } from './app/app.component';\nexport const boot = [appConfig, AppComponent];\n" > src/main.ts
  printf "export { CustomerAvatarComponent } from './ui/customer-avatar/customer-avatar.component';\n" > src/app/features/customers/index.ts
  cat > sheriff.config.ts <<'TS'
import { SheriffConfig, sameTag } from '@softarc/sheriff-core';
export const config: SheriffConfig = {
  entryFile: 'src/main.ts',
  modules: { 'src/app/features/<feature>': ['domain:<feature>'], 'src/app/shared': ['shared'], 'src/app/core': ['core'], 'src/app/layout': ['layout'] },
  depRules: { root: ['*'], 'domain:*': [sameTag, 'shared', 'core'], shared: [], core: ['shared'], layout: ['shared', 'core'] },
};
TS
  git switch -q main && git add -A && git commit -qm "add sheriff"
  out=$($G --main 2>&1); has "$(cat docs/FLOORPLAN.md)" "sheriff:encapsulation" "Sheriff violations in the main map"
  has "$(cat docs/FLOORPLAN.md)" "deep import ../../customers/ui/customer-avatar/customer-avatar.component" "Sheriff deep import named"
  git add -A && git commit -qm "map with sheriff" && git switch -q -c feature/sheriff
  out=$($G --check 2>&1); code $? 0 "Sheriff issues on main don't block (base map ran Sheriff too)"
  sed -i.bak "1a import { CustomerAvatarComponent } from '../../customers/ui/customer-avatar/customer-avatar.component';\nexport const X = CustomerAvatarComponent;" src/app/features/settings/settings-page/settings-page.component.ts && rm -f src/app/features/settings/settings-page/*.bak
  out=$($G --check 2>&1); code $? 1 "new Sheriff violation fails the check"
  has "$out" "deep import ../../customers/ui/customer-avatar/customer-avatar.component" "new Sheriff violation named"
  git checkout -q -- .
else
  ok "Sheriff tests skipped (set SHERIFF_PKG to an @softarc/sheriff-core package folder)"
fi

echo "== 14. CLAUDE.md section, ignored map folder, outputs, version"
printf '# Team\r\n\r\n## Project structure\r\n\r\n@docs/FLOORPLAN.md\r\n\r\n- old\r\n\r\n## Other\r\n\r\nKeep.\r\n' > CLAUDE.md
out=$(node scripts/floorplan/claude-md.mjs --no-ci 2>&1); has "$out" "replaced the older section" "older section replaced"; has "$out" "CRLF kept" "CRLF kept"
grep -q "Keep." CLAUDE.md && grep -q "there is no CI job" CLAUDE.md && ok "rest of CLAUDE.md kept, no-CI wording" || bad "CLAUDE.md content"
[ "$(grep -c $'\r$' CLAUDE.md)" = "$(wc -l < CLAUDE.md)" ] && ok "every line still CRLF" || bad "mixed line endings"
out=$(node scripts/floorplan/claude-md.mjs --no-ci 2>&1); has "$out" "up to date" "idempotent"
printf 'docs/\n' >> .gitignore
out=$($G --main 2>&1); has "$out" "is ignored by git" "warns when the main map folder is gitignored"
git checkout -q -- .gitignore
out=$($G --outputs); has "$out" "docs/FLOORPLAN.md docs/floorplan.json" "--outputs for CI templates"
out=$(git switch -q -c feat/x && env -u CI -u TF_BUILD $G --main 2>&1); has "$out" "The main map describes main" "warns when --main runs on a branch (CI unset: the warning is off in CI on purpose)"

echo "== 15. Per-edit hook, fixes, PR comment, cache"
SP2=$TMP/spring2
cp -r "$REPO/sample-spring-app" "$SP2" && cd "$SP2"
mkdir -p scripts/floorplan && cp -r "$TOOLS"/. scripts/floorplan/ && cp "$SKILL/templates/floorplan.config.spring.mjs" floorplan.config.mjs
git init -q -b main && git add -A && git commit -qm sample
G="node scripts/floorplan/generate-map.mjs"
$G --main >/dev/null 2>&1 && git add -A && git commit -qm map
out=$($G --main 2>&1); has "$out" "move-cli.mjs shared/OrderPricingService.java orders\` (dry run)" "fix suggestion: the feature the class uses"
[ -f .floorplan/cache-spring.json ] && ok "per-file cache written (.floorplan/)" || bad "no cache file"
m1=$(md5sum < docs/FLOORPLAN.md); $G --main >/dev/null 2>&1; m2=$(md5sum < docs/FLOORPLAN.md); [ "$m1" = "$m2" ] && ok "cached run gives the same map" || bad "cached map differs"
git switch -q -c feature/hook
printf 'package com.acme.shop.config;\n\nimport com.acme.shop.customers.CustomerRepository;\nimport org.springframework.stereotype.Service;\n\n@Service\npublic class ExtraService {\n    private final CustomerRepository repo;\n    public ExtraService(CustomerRepository r) { this.repo = r; }\n}\n' > src/main/java/com/acme/shop/config/ExtraService.java
out=$(printf '{"tool_name":"Write","tool_input":{"file_path":"%s/src/main/java/com/acme/shop/config/ExtraService.java"}}' "$SP2" | CLAUDE_PROJECT_DIR="$SP2" $G --hook)
has "$out" '"hookEventName":"PostToolUse"' "hook answers with PostToolUse context"
has "$out" "config/ExtraService.java breaks a project rule" "hook names the file and the issue"
has "$out" "move-cli.mjs config/ExtraService.java customers" "hook suggests the fix (uses customers)"
out=$(printf '{"tool_name":"Write","tool_input":{"file_path":"%s/src/main/java/com/acme/shop/orders/OrderDto.java"}}' "$SP2" | CLAUDE_PROJECT_DIR="$SP2" $G --hook); [ -z "$out" ] && ok "hook is silent for a clean file" || bad "hook spoke for a clean file" "$out"
out=$(echo 'not json' | CLAUDE_PROJECT_DIR="$SP2" $G --hook); code $? 0 "hook never fails"
out=$(node scripts/floorplan/move-cli.mjs config/ExtraService.java --fix --apply 2>&1); has "$out" "Fix for services-in-features: move to customers/" "move-cli --fix"
[ -f src/main/java/com/acme/shop/customers/ExtraService.java ] && ok "--fix moved the class" || bad "--fix did not move"
out=$(node scripts/floorplan/move-cli.mjs customers/ExtraService.java billing 2>&1); has "$out" "add --create" "missing target folder: hint for --create"
out=$(node scripts/floorplan/move-cli.mjs customers/ExtraService.java billing --create --apply 2>&1); code $? 0 "--create makes the new package"
grep -q "^package com.acme.shop.billing;" src/main/java/com/acme/shop/billing/ExtraService.java && ok "class in the new package" || bad "new package"
cp src/main/java/com/acme/shop/customers/CustomerService.java src/main/java/com/acme/shop/config/X2Service.java
sed -i.bak 's/package com.acme.shop.customers;/package com.acme.shop.config;\nimport com.acme.shop.customers.*;/; s/CustomerService/X2Service/g' src/main/java/com/acme/shop/config/X2Service.java && rm -f src/main/java/com/acme/shop/config/*.bak
$G --check --pr-comment "$TMP/pr.md" >/dev/null 2>&1; code $? 1 "check with --pr-comment still fails on new issues"
pr=$(cat "$TMP/pr.md")
has "$pr" "<!-- floorplan -->" "PR comment marker"
has "$pr" "**New rule issues (the check fails)**" "PR comment: new issues section"
has "$pr" "**Fix:** Move it (imports are rewritten, git history kept): \`node scripts/floorplan/move-cli.mjs config/X2Service.java" "PR comment: fix command"
has "$pr" "New dependencies between areas" "PR comment: area dependencies"
git reset -q --hard && git clean -qfd src && git switch -q main
out=$(node scripts/floorplan/install-hooks.mjs --claude 2>&1); has "$out" "edit check (PostToolUse)" "installer adds the edit check"
grep -q '"matcher": "Write|Edit|MultiEdit"' .claude/settings.json && grep -q -- "--hook" .claude/settings.json && ok "PostToolUse hook in settings" || bad "PostToolUse hook missing"

echo "== 16. Split map, Nx, ArchUnit"
node -e "const fs=require('fs');let c=fs.readFileSync('floorplan.config.mjs','utf8');fs.writeFileSync('floorplan.config.mjs',c.replace(\"framework: 'spring',\",\"framework: 'spring',\n  split: true,\"))"
out=$($G --main 2>&1); md=$(cat docs/FLOORPLAN.md)
has "$md" "## Areas" "split view: overview with areas"
has "$md" "floorplan-areas/orders.md" "split view: link to the area file"
has "$(cat docs/floorplan-areas/orders.md)" "# Area orders" "area detail file"
has "$(cat docs/floorplan-areas/orders.md)" "| GET /api/orders/{id} |" "area file has its endpoints"
has "$($G --outputs)" "docs/floorplan-areas" "--outputs includes the area folder"
git checkout -q -- floorplan.config.mjs && rm -rf docs/floorplan-areas
mkdir -p src/test/java/com/acme/shop
cat > src/test/java/com/acme/shop/ArchitectureTest.java <<'JAVA'
package com.acme.shop;
import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.noClasses;
import static com.tngtech.archunit.library.Architectures.layeredArchitecture;
import com.tngtech.archunit.junit.ArchTest;
import com.tngtech.archunit.lang.ArchRule;
class ArchitectureTest {
    @ArchTest
    static final ArchRule sharedIsIndependent = noClasses().that().resideInAPackage("..shop.shared..")
        .should().dependOnClassesThat().resideInAnyPackage("..orders..", "..customers..");
    @ArchTest
    static final ArchRule layers = layeredArchitecture().consideringAllDependencies()
        .layer("Orders").definedBy("..orders..")
        .layer("Customers").definedBy("..customers..")
        .whereLayer("Customers").mayNotBeAccessedByAnyLayer();
}
JAVA
out=$($G --main 2>&1)
has "$out" "archunit:sharedIsIndependent" "ArchUnit noClasses rule"
has "$out" "orders/OrderService.java imports customers/Customer.java" "ArchUnit layered rule finds the access"
has "$(cat docs/FLOORPLAN.md)" "rule(s) from ArchUnit tests" "ArchUnit listed under Rules"
NX=$TMP/nx
mkdir -p "$NX/libs/a/src/lib" "$NX/libs/b/src" "$NX/libs/shared/src" && cd "$NX"
echo '{}' > nx.json; echo '{"compilerOptions":{}}' > tsconfig.json
echo '{"name":"a","sourceRoot":"libs/a/src","tags":["scope:a"]}' > libs/a/project.json
echo '{"name":"b","sourceRoot":"libs/b/src","tags":["scope:b"]}' > libs/b/project.json
echo '{"name":"shared","sourceRoot":"libs/shared/src","tags":["scope:shared"]}' > libs/shared/project.json
echo "export const b = 1;" > libs/b/src/index.ts; echo "export const s = 1;" > libs/shared/src/index.ts
printf "import { b } from '../../../b/src/index';\nimport { s } from '../../../shared/src/index';\nexport const a = b + s;\n" > libs/a/src/lib/a.ts
cat > eslint.config.mjs <<'JS'
export default [{ files: ['**/*.ts'], rules: { '@nx/enforce-module-boundaries': ['error', { depConstraints: [
  { sourceTag: 'scope:a', onlyDependOnLibsWithTags: ['scope:a', 'scope:shared'] } ] }] } }];
JS
printf "export default { framework: 'angular', root: '.', units: ['libs/*'] };\n" > floorplan.config.mjs
mkdir -p scripts/floorplan && cp -r "$TOOLS"/. scripts/floorplan/ && git init -q -b main && git add -A && git commit -qm nx
out=$(node scripts/floorplan/generate-map.mjs --main 2>&1)
has "$out" "libs/a/src/lib/a.ts imports libs/b/src/index.ts (a [scope:a] → b [scope:b]: scope:a may only depend on scope:a, scope:shared)" "Nx depConstraints (flat ESLint config)"
has "$out" "1 violations" "Nx: allowed dependency on shared not reported"

echo "== 17. Graph server: Host, Origin and token checks, file shapes"
cd "$APP"
out=$(node - "$APP" <<'JS' 2>&1
const { spawn } = require('node:child_process');
const port = 4300 + Math.floor(Math.random() * 500);
const srv = spawn(process.execPath, ['scripts/floorplan/server.mjs', '--port', String(port)], { cwd: process.argv[2], stdio: 'ignore' });
const base = `http://127.0.0.1:${port}`;
const st = (path, headers = {}, method = 'GET') => fetch(base + path, { method, headers }).then((r) => r.status).catch(() => 0);
(async () => {
  let page = '';
  for (let i = 0; i < 50 && !page; i++) { await new Promise((r) => setTimeout(r, 200)); page = await fetch(base + '/').then((r) => r.text()).catch(() => ''); }
  const token = (page.match(/name="pm-token" content="([a-f0-9]+)"/) || [])[1] || '';
  const csp = await fetch(base + '/').then((r) => r.headers.get('content-security-policy') || '');
  console.log('token-length', token.length);
  console.log('csp', csp.includes("default-src 'self'"));
  console.log('no-token', await st('/api/map'));
  console.log('with-token', await st('/api/map', { 'x-floorplan-token': token }));
  console.log('wrong-token', await st('/api/map', { 'x-floorplan-token': 'x'.repeat(token.length) }));
  console.log('foreign-origin', await st('/api/undo', { 'x-floorplan-token': token, origin: 'http://evil.example' }, 'POST'));
  // fetch() drops a custom Host header, so use http.request for the rebinding case
  const hostStatus = await new Promise((res) => require('node:http').get({ host: '127.0.0.1', port, path: '/', headers: { host: `evil.example:${port}` } },
    (r) => { r.resume(); res(r.statusCode); }).on('error', () => res(0)));
  console.log('rebound-host', hostStatus);
  srv.kill();
})();
JS
)
has "$out" "token-length 48" "server puts a per-start token into the page"
has "$out" "csp true" "page is served with a Content-Security-Policy"
has "$out" "no-token 403" "API call without token is refused"
has "$out" "with-token 200" "API call with token works"
has "$out" "wrong-token 403" "API call with a wrong token is refused"
has "$out" "foreign-origin 403" "cross-origin POST is refused (CSRF)"
has "$out" "rebound-host 403" "unknown Host header is refused (DNS rebinding)"
ui=$(cat "$TOOLS/ui.html")
has "$ui" "SHAPE_ANGULAR" "UI has file shapes for Angular kinds"
has "$ui" "SHAPE_SPRING" "UI has file shapes for Spring kinds"

echo "== 18. Rule behaviour: type-only imports, accepted, budget, errorFrom, why"
R=$TMP/rules
cp -r "$REPO/sample-app" "$R" && cd "$R" || { bad "fixture $R"; exit 1; }
rm -rf node_modules
mkdir -p scripts/floorplan && cp -r "$TOOLS"/. scripts/floorplan/
mkdir -p src/app/features/customers/data-access
printf 'export interface CustomerRef { id: string }\nexport type CustomerId = string;\n' > src/app/features/customers/data-access/customer.types.ts
printf "export * from './customer.types';\n" > src/app/features/customers/data-access/index.ts
printf "import { CustomerRef } from '../../customers/data-access/customer.types';\nimport type { CustomerId } from '../../customers/data-access';\nexport const ref: CustomerRef | null = null;\nexport const id: CustomerId = '';\n" > src/app/features/orders/data-access/order-ref.ts
printf "import { CustomerRef } from '../../customers/data-access';\nexport let r: CustomerRef;\n" > src/app/features/orders/data-access/order-ref2.ts
cat > floorplan.config.mjs <<'JS'
export default {
  framework: 'angular', root: 'src/app', units: ['features/*'], typeImports: process.env.TI || 'error',
  accepted: [
    { rule: 'features-are-isolated', file: 'features/orders/order-detail/*.ts', detail: 'customer-avatar', reason: 'moves to shared in JIRA-1' },
    { rule: 'features-are-isolated', file: 'features/gone.ts', reason: 'stale' },
  ],
  budget: { 'services-placement': Number(process.env.BUDGET || 5) },
  rules: [
    { name: 'features-are-isolated', type: 'noImport', from: 'features/*', to: 'features/*', allowSame: true, message: 'no cross-feature imports',
      why: 'Isolated features can be deleted on their own.', docs: 'https://example.com/rules#isolated' },
    { name: 'services-placement', type: 'placement', kinds: ['service'], allowedIn: ['core', 'features/*/data-access'], message: 'services in data-access', errorFrom: '2999-01-01' },
  ],
};
JS
git init -q -b main && git add -A && git commit -qm base
G="node scripts/floorplan/generate-map.mjs"
out=$($G --main 2>&1)
has "$out" "order-ref.ts imports features/customers/data-access/customer.types.ts (types only)" "interface-only import detected"
has "$out" "order-ref.ts imports features/customers/data-access/index.ts (types only)" "import type through a barrel detected"
has "$out" "order-ref2.ts imports features/customers/data-access/index.ts (types only)" "interface re-exported by a barrel is type-only"
has "$out" "why: Isolated features can be deleted on their own." "why is printed"
has "$out" "docs: https://example.com/rules#isolated" "docs link is printed"
has "$out" "accepted entry matches nothing anymore" "stale accepted entry is reported"
has "$out" "(warning until 2999-01-01, then an error)" "errorFrom turns the error into a warning"
md=$(cat docs/FLOORPLAN.md)
has "$md" "## Accepted exceptions (1)" "accepted issue listed separately"
has "$md" "moves to shared in JIRA-1" "accepted reason shown"
if grep -q "order-detail.component.ts\` imports features/customers/ui" <<<"$(sed -n '/## Violations/,/## Accepted/p' docs/FLOORPLAN.md)"; then bad "accepted issue still counted"; else ok "accepted issue not counted"; fi
out=$(TI=warn $G --main 2>&1; cat docs/FLOORPLAN.md)
has "$out" "! \`features/orders/data-access/order-ref.ts\` imports features/customers/data-access/customer.types.ts (types only)" "typeImports warn: reported as warning"
out=$(TI=ignore $G --main 2>&1)
if grep -q "(types only)" <<<"$out"; then bad "typeImports ignore still reports"; else ok "typeImports ignore: not reported"; fi
TI=ignore $G --main >/dev/null 2>&1; git add -A && git commit -qm "main map" && git checkout -qb feature
mkdir -p src/app/features/orders/extra
printf "import { Injectable } from '@angular/core';\n@Injectable({ providedIn: 'root' })\nexport class ExtraService {}\n" > src/app/features/orders/extra/extra.service.ts
out=$(TI=ignore BUDGET=5 $G --check 2>&1); c=$?
code $c 1 "budget ratchet: more issues than on main fails even under the configured budget"
has "$out" "over budget: services-placement: 2 issues, allowed 1 (main has 1; the budget only goes down)" "over-budget message"
mkdir -p src/app/features/customers/data-access && git mv -k src/app/features/customers/customer-list/customer-export.service.ts src/app/features/customers/data-access/ 2>/dev/null
out=$(TI=ignore BUDGET=5 $G --check 2>&1); c=$?
code $c 0 "budget: a new issue that replaces a fixed one passes"
has "$out" "budget services-placement: 1 issues, budget 5. Lower the budget in floorplan.config.mjs to 1." "budget can be lowered"
git checkout -q -- . && git clean -qfd src && git reset -q --hard

echo "== 19. Rule types: layers, cycles, packages, size, lazy, orphans, purpose, unused, folders, relative, routed"
cd "$R" && git checkout -q main && git checkout -qb rules2
mkdir -p src/app/shared/state src/app/features/reports src/app/core/misc
printf "import { Store } from '@ngrx/store';\nimport { x } from 'rxjs/internal/util';\nimport { AuthService } from '../../core/auth/auth.service';\nexport const s = [Store, x, AuthService];\n" > src/app/shared/state/bad.ts
printf "import { b } from './b';\nexport const a = () => b;\n" > src/app/core/misc/a.ts
printf "import { a } from './a';\nexport const b = () => a;\n" > src/app/core/misc/b.ts
printf "import { OrdersService } from '../orders/data-access/orders.service';\nexport const r = OrdersService;\n" > src/app/features/reports/reports-page.ts
printf "import { r } from '../reports/reports-page';\nexport const back = r;\n" > src/app/features/orders/back.ts
printf "describe('gone', () => {});\n" > src/app/shared/ui/gone.component.spec.ts
for i in $(seq 1 30); do echo "// line $i" >> src/app/core/http/api-base.service.ts; done
cat > floorplan.config.mjs <<'JS'
export default {
  framework: 'angular', root: 'src/app', units: ['features/*'],
  folders: { 'features/orders': { purpose: 'Orders', owner: '@acme/orders' }, 'features/customers': { purpose: 'Customers', owner: 'nobody' } },
  rules: [
    { name: 'layers', type: 'layers', layers: ['features', ['layout', 'core'], 'shared'] },
    { name: 'no-area-cycles', type: 'noCycles' },
    { name: 'no-file-cycles', type: 'noCycles', level: 'file' },
    { name: 'no-store-in-shared', type: 'noPackage', from: 'shared', packages: ['@ngrx/store', 'rxjs/internal/**'] },
    { name: 'big-files', type: 'maxSize', maxLines: 30, files: 'core' },
    { name: 'hubs', type: 'maxFanIn', max: 2 },
    { name: 'lazy', type: 'lazyBoundary' },
    { name: 'orphans', type: 'orphanTests' },
    { name: 'purpose', type: 'purpose', folders: 'features/*' },
    { name: 'owners', type: 'owners', folders: 'features/*' },
    { name: 'unused', type: 'unused' },
    { name: 'lonely', type: 'singleFileFolders' },
    { name: 'relative', type: 'relativeImports', maxUp: 1 },
    { name: 'routed', type: 'routed', folders: 'features/*' },
  ],
};
JS
out=$($G --main 2>&1; cat docs/FLOORPLAN.md)  # the console shows 3 issues per rule, the map all
has "$out" "shared/state/bad.ts imports core/auth/auth.service.ts" "layers: shared must not use core"
has "$out" "features/orders/back.ts imports features/reports/reports-page.ts (cycle: features/orders → features/reports → features/orders)" "noCycles: weakest link of an area cycle"
has "$out" "core/misc/a.ts imports core/misc/b.ts (cycle: core/misc/a.ts → core/misc/b.ts → core/misc/a.ts)" "noCycles level file"
has "$out" "shared/state/bad.ts uses @ngrx/store" "noPackage: package"
has "$out" "shared/state/bad.ts uses rxjs/internal/util" "noPackage: deep import pattern"
has "$out" "core/http/api-base.service.ts is longer than 30 lines" "maxSize lines"
has "$out" "is imported by more than 2 files" "maxFanIn"
has "$out" "features/orders/order-detail/order-detail.component.ts imports features/customers/ui/customer-avatar/customer-avatar.component.ts" "lazyBoundary: eager import of a lazy feature"
has "$out" "shared/ui/gone.component.spec.ts tests gone.component.ts, which no longer exists" "orphanTests (Angular)"
has "$out" "features/settings has no purpose in floorplan.config.mjs" "purpose rule"
has "$out" "features/settings has no owner" "owners rule (folder without owner)"
has "$out" "shared/directives/autofocus.directive.ts\` is not imported anywhere" "unused files"
has "$out" "features/reports/reports-page.ts is alone in features/reports/" "single-file folders"
has "$out" "(relative path ../orders/data-access/orders.service)" "relativeImports across areas"
has "$out" "features/reports is not reachable from any route" "routed rule"
j=$(cat docs/floorplan.json)
grep -q '"_typeOnly"\|"_ext"' <<<"$j" && bad "in-memory fields leaked into the JSON" || ok "in-memory fields stay out of the JSON"
has "$j" '"lines":' "JSON has line counts"

echo "== 20. Presets, extraction planner, CODEOWNERS, change coupling, related tests"
cd "$R" && git checkout -q -- . && git clean -qfd src && git checkout -q main
printf "export default { presets: ['angular-feature-sliced'], folders: { 'features/orders': { owner: '@acme/orders' }, core: { owner: 'platform-team' } } };\n" > floorplan.config.mjs
out=$($G --main 2>&1)
has "$out" "features-are-isolated" "preset rules are active"
has "$(cat docs/FLOORPLAN.md)" "**layers** (error, from preset angular-feature-sliced)" "preset rule listed in the map, with its origin"
printf "export default { presets: ['angular-feature-sliced'], rules: [{ name: 'unused-files', type: 'unused', severity: 'off' }, { name: 'layers', type: 'layers', layers: ['features', 'shared'], severity: 'warn' }] };\n" > p2.mjs
out=$($G --main --config p2.mjs 2>&1)
if grep -q "is not imported anywhere" <<<"$out"; then bad "severity off did not remove the preset rule"; else ok "severity 'off' removes a preset rule"; fi
has "$(cat docs/FLOORPLAN.md)" "**layers** (warn, from p2.mjs)" "own rule replaces the preset rule with the same name"
out=$(node scripts/floorplan/move-cli.mjs features/orders/orders.routes.ts features/orders 2>&1 --config p2.mjs); rm -f p2.mjs
out=$($G --plan-extract features-are-isolated 2>&1)
has "$out" "Move 1 file(s) → fixes 2 issue(s), adds 0" "extraction planner: fixes and adds"
has "$out" "move-cli.mjs features/customers/ui/customer-avatar shared/ui --create" "extraction planner: folder command"
has "$out" "All together" "extraction planner: total"
git status --porcelain src | grep -q . && bad "planner changed files" || ok "planner changes nothing"
out=$(node scripts/floorplan/codeowners.mjs 2>&1)
has "$out" "/src/app/features/orders/ @acme/orders" "CODEOWNERS preview"
has "$out" "is not a GitHub/GitLab @user" "CODEOWNERS warns about invalid owners"
node scripts/floorplan/codeowners.mjs --write >/dev/null 2>&1; node scripts/floorplan/codeowners.mjs --write >/dev/null 2>&1
n=$(grep -c ">>> floorplan" .github/CODEOWNERS); [ "$n" = 1 ] && ok "CODEOWNERS --write is idempotent" || bad "CODEOWNERS section written $n times"
git add -A && git commit -qm presets
for i in 1 2 3 4; do echo "// $i" >> src/app/features/orders/order-list/order-list.component.ts; echo "// $i" >> src/app/shared/pipes/eur.pipe.ts; git commit -qam "co $i"; done
out=$(node scripts/floorplan/cochange.mjs --min 3 2>&1)
has "$out" "| features/orders/order-list/order-list.component.ts | shared/pipes/eur.pipe.ts | 4 |" "change coupling between areas"
[ -f .floorplan/COCHANGE.md ] && ok "COCHANGE.md written" || bad "COCHANGE.md missing"
git checkout -qb tests-branch
echo "// changed" >> src/app/features/orders/data-access/orders.service.ts
npm pkg set devDependencies.jest="^29" >/dev/null 2>&1
$G >/dev/null 2>&1; b=$(cat .floorplan/BRANCH_CHANGES.md)
has "$b" "## Files that use the changed files (check them)" "branch report lists dependents"
has "$b" "features/orders/order-list/order-list.component.ts (uses features/orders/data-access/orders.service.ts)" "dependent with the file it uses"
has "$b" "npx jest --findRelatedTests src/app/features/orders/data-access/orders.service.ts" "related tests command (jest)"
out=$($G --session 2>&1); has "$out" "Related tests: npx jest" "session summary has the test command"

WS=$TMP/workspaces
mkdir -p "$WS/libs/a/src" "$WS/libs/b/src" && cd "$WS"
printf '{ "name": "ws", "private": true, "workspaces": ["libs/*"] }\n' > package.json
printf '{ "name": "@x/a", "exports": { ".": { "types": "./src/index.ts" }, "./sub": { "import": "./src/sub.ts" } } }\n' > libs/a/package.json
printf '{ "name": "@x/b" }\n' > libs/b/package.json
echo "export const a = 1;" > libs/a/src/index.ts; echo "export const s = 1;" > libs/a/src/sub.ts
printf "import { a } from '@x/a';\nimport { s } from '@x/a/sub';\nexport const b = a + s;\n" > libs/b/src/index.ts
printf "export default { framework: 'angular', root: '.', units: ['libs/*'], rules: [{ name: 'no-b-to-a', type: 'noImport', from: 'libs/b', to: 'libs/a' }] };\n" > floorplan.config.mjs
mkdir -p scripts/floorplan && cp -r "$TOOLS"/. scripts/floorplan/
out=$(node scripts/floorplan/generate-map.mjs --main 2>&1)
has "$out" "libs/b/src/index.ts imports libs/a/src/index.ts" "workspace package resolved through exports"
has "$out" "libs/b/src/index.ts imports libs/a/src/sub.ts" "workspace subpath export resolved"

echo "== 21. Spring rules: field injection, proxy annotations, orphan tests, presets, related tests"
SR=$TMP/spring-rules
cp -r "$REPO/sample-spring-app" "$SR" && cd "$SR" || { bad "fixture $SR"; exit 1; }
mkdir -p scripts/floorplan && cp -r "$TOOLS"/. scripts/floorplan/
B=src/main/java/com/acme/shop
cat > $B/orders/AuditService.java <<'JAVA'
package com.acme.shop.orders;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.RequestParam;

@Service
public class AuditService {
    @Autowired
    private OrderRepository orders;

    @Transactional
    private void record(String what) { }

    @Transactional(readOnly = true)
    public final int count(@RequestParam("x") String x) { return 0; }

    @Transactional
    public void ok() { record("x"); }
}
JAVA
printf 'package com.acme.shop.orders;\n\nclass MoneyTest { }\n' > src/test/java/com/acme/shop/orders/MoneyTest.java
printf 'package com.acme.shop;\n\nclass CheckoutScenarioTest { }\n' > src/test/java/com/acme/shop/CheckoutScenarioTest.java
printf "export default { root: '$B', presets: ['spring-layered'] };\n" > floorplan.config.mjs
git init -q -b main && git add -A && git commit -qm base
G="node scripts/floorplan/generate-map.mjs"
out=$($G --main 2>&1)
has "$out" "orders/AuditService.java injects orders through a field" "field injection"
has "$out" "@Transactional on private method record()" "proxy annotation on a private method"
has "$out" "@Transactional on final method count()" "proxy annotation on a final method"
if grep -q "method ok()" <<<"$out"; then bad "public @Transactional flagged"; else ok "public @Transactional method is fine"; fi
has "$out" "tests Money, which is in package com.acme.shop.shared now" "test left behind after its class moved"
if grep -q "CheckoutScenario" <<<"$out"; then bad "scenario test reported as orphan"; else ok "tests not named after a class are not reported"; fi
has "$out" "orders/AuditService.java uses org.springframework.web.bind.annotation.RequestParam" "noPackage on Java packages"
has "$out" "shared/OrderPricingService.java imports orders/Order.java (cycle: shared → orders → shared)" "package cycle: weakest link"
printf "export default { root: '$B', presets: ['spring-hexagonal'] };\n" > hex.mjs
mkdir -p $B/billing/domain && printf 'package com.acme.shop.billing.domain;\n\nimport org.springframework.stereotype.Component;\n\n@Component\npublic class Invoice { }\n' > $B/billing/domain/Invoice.java
out=$($G --main --config hex.mjs 2>&1)
has "$out" "billing/domain/Invoice.java uses org.springframework.stereotype.Component" "hexagonal preset: framework-free domain"
rm -rf $B/billing hex.mjs
git add -A && git commit -qm maps && git checkout -qb feature
echo "// changed" >> $B/orders/OrderService.java
$G >/dev/null 2>&1; b=$(cat .floorplan/BRANCH_CHANGES.md)
has "$b" "mvn test -Dtest=OrderControllerTest,OrderServiceTest" "related tests command (Maven)"
has "$b" "orders/OrderController.java (uses orders/OrderService.java)" "Spring dependents"

echo "== 22. CLAUDE.md rules: source of truth, warnings, replaced rules, refresh note, hook, messages"
CM=$TMP/claude-md
cp -r "$REPO/sample-app" "$CM" && cd "$CM" || { bad "fixture $CM"; exit 1; }
rm -rf node_modules; mkdir -p scripts/floorplan && cp -r "$TOOLS"/. scripts/floorplan/ && cp "$SKILL/templates/floorplan.config.mjs" .
git init -q -b main && git add -A && git commit -qm base
G="node scripts/floorplan/generate-map.mjs"
out=$($G --main 2>&1); if grep -q "/floorplan rules" <<<"$out"; then bad "rules note without CLAUDE.md"; else ok "no CLAUDE.md: no rules note"; fi
printf '# App\n\n- Services live in data-access or next to the list component that exports.\n- Never use any.\n- Components use ChangeDetectionStrategy.OnPush.\n- Write the test first.\n' > CLAUDE.md
out=$($G --main 2>&1); has "$out" "run /floorplan rules once to turn them into checks" "CLAUDE.md without rules file: note to run /floorplan rules"
node scripts/floorplan/claude-md.mjs --no-ci >/dev/null 2>&1
H=$(node scripts/floorplan/claude-rules-hash.mjs CLAUDE.md)
has "$H" '"CLAUDE.md":' "claude-rules-hash prints the fingerprints"
cat > floorplan.claude-rules.json <<JSON
{ "generatedBy": "/floorplan rules", "sources": $H,
  "rules": [
    { "name": "services-placement", "type": "placement", "kinds": ["service"], "allowedIn": ["core", "features/*/data-access", "features/*/customer-list"],
      "message": "Services live in data-access.", "howToFix": "Move it into features/<name>/data-access/.",
      "source": { "file": "CLAUDE.md", "line": 3, "text": "Services live in data-access or next to the list component that exports." }, "replaces": ["services-placement"] },
    { "name": "no-any", "type": "pattern", "files": "**/*.ts", "pattern": ":\\\\s*any\\\\b|as any\\\\b", "what": "the any type",
      "message": "The project bans any.", "howToFix": "Use a real type or unknown plus a type guard.",
      "source": { "file": "CLAUDE.md", "line": 4, "text": "Never use any." } },
    { "name": "onpush", "type": "requirePattern", "kinds": ["component"], "pattern": "ChangeDetectionStrategy\\\\.OnPush", "what": "OnPush",
      "source": { "file": "CLAUDE.md", "line": 5, "text": "Components use ChangeDetectionStrategy.OnPush." }, "confirms": ["one-angular-class-per-file"] }
  ],
  "notCheckable": [ { "source": { "file": "CLAUDE.md", "line": 6, "text": "Write the test first." }, "reason": "process" } ] }
JSON
printf "export function parse(x: any) {\n  // any in a comment is fine\n  return x as any;\n}\n" > src/app/core/http/parse.ts
out=$($G --main 2>&1; cat docs/FLOORPLAN.md)
has "$out" "! src/app/core/http/parse.ts:1 contains the any type (2×, lines 1, 3)" "pattern rule: file, first line, all lines; comments ignored"
has "$out" "rule: claude-md:no-any (warning, from CLAUDE.md:4 \"Never use any.\")" "CLAUDE.md rule is a warning with its source line and quote"
has "$out" "fix: Use a real type or unknown plus a type guard." "CLAUDE.md rule's how-to-fix"
has "$out" "does not contain OnPush" "requirePattern rule"
has "$out" "~~services-placement~~ switched off: CLAUDE.md:3 says otherwise" "CLAUDE.md replaces a contradicting built-in rule"
if grep -q "customer-export.service.ts must be in" <<<"$out"; then bad "replaced rule still reports"; else ok "replaced rule no longer reports"; fi
has "$out" "confirmed by CLAUDE.md:5" "CLAUDE.md confirms an existing rule"
has "$out" "1 CLAUDE.md rule(s) can't be checked automatically" "not-checkable statements counted"
if grep -q "/floorplan rules" <<<"$($G --main 2>&1)"; then bad "fresh rules reported as stale"; else ok "unchanged CLAUDE.md: no refresh note (own section ignored)"; fi
node scripts/floorplan/claude-md.mjs >/dev/null 2>&1
if grep -q "/floorplan rules" <<<"$($G --main 2>&1)"; then bad "regenerating the Floorplan section made the rules stale"; else ok "Floorplan's own CLAUDE.md section doesn't count as a change"; fi
$G --check >/dev/null 2>&1; code $? 0 "CLAUDE.md warnings never fail the check"
git add -A && git commit -qm rules && git checkout -qb feat
echo "- Use signals for component state." >> CLAUDE.md
out=$($G 2>&1); has "$out" "CLAUDE.md changed since the Floorplan rules were derived from it (CLAUDE.md)" "changed CLAUDE.md: refresh note"
out=$($G --session 2>&1); has "$out" "run /floorplan rules" "session summary mentions the refresh"
mkdir -p src/app/features/orders/order-notes
printf "import { Component } from '@angular/core';\n@Component({ selector: 'app-order-notes', template: '' })\nexport class OrderNotesComponent { notes: any[] = []; }\n" > src/app/features/orders/order-notes/order-notes.component.ts
out=$(printf '{"tool_input":{"file_path":"%s"},"cwd":"%s"}' "$CM/src/app/features/orders/order-notes/order-notes.component.ts" "$CM" | $G --hook 2>&1)
has "$out" "src/app/features/orders/order-notes/order-notes.component.ts:3: contains the any type (claude-md:no-any, warning; from CLAUDE.md:4" "hook: file:line and CLAUDE.md source"
has "$out" "How to fix: Use a real type" "hook: how to fix"
has "$out" "These come from the project's CLAUDE.md" "hook: CLAUDE.md warnings are to be fixed"
printf "export default { claudeMdSeverity: 'error', framework: 'angular', root: 'src/app' };\n" > strict.mjs
out=$($G --main --config strict.mjs 2>&1); has "$out" "✗ src/app/core/http/parse.ts:1 contains the any type" "claudeMdSeverity: 'error' makes them errors"
rm -f strict.mjs
echo '{ not json' > floorplan.claude-rules.json
out=$($G 2>&1); c=$?; has "$out" "floorplan.claude-rules.json could not be read" "broken rules file: clear warning"; code $c 0 "broken rules file doesn't break the map"
git checkout -q -- . && git clean -qfd src

echo "== 23. Messages: line numbers, sources, how to fix"
cd "$CM"
out=$($G --main 2>&1)
has "$out" "✗ src/app/features/orders/order-detail/order-detail.component.ts:3 imports features/customers/ui/customer-avatar/customer-avatar.component.ts" "import issue: repository path with the import's line"
has "$out" "rule: features-are-isolated (error, from floorplan.config.mjs)" "rule and where it comes from"
has "$out" "fix: Remove the import of features/customers/ui/customer-avatar/customer-avatar.component.ts (line 3)" "how to fix an import issue"
has "$out" "--plan-extract features-are-isolated" "fix points to the extraction planner"
md=$(cat docs/FLOORPLAN.md)
has "$md" "\`features/orders/order-detail/order-detail.component.ts:3\` imports" "map: file:line"
has "$md" "  Fix: Remove the import" "map: fix line under the issue"
j=$(cat docs/floorplan.json); has "$j" '"howToFix":' "JSON: howToFix"; has "$j" '"line": 3' "JSON: line"; has "$j" '"source": "floorplan.config.mjs"' "JSON: source"
cd "$SR" && out=$(node scripts/floorplan/generate-map.mjs --main 2>&1)
has "$out" "src/main/java/com/acme/shop/orders/AuditService.java" "Spring: repository-relative path"
has "$out" "fix: Make the field private final, remove @Autowired" "Spring: how to fix field injection"
has "$out" "(warning, from preset spring-layered)" "Spring: preset as the source"

echo "== 24. Migration from project-map (before the rename)"
OLD=$TMP/old-name
cp -r "$REPO/sample-app" "$OLD" && cd "$OLD" || { bad "fixture $OLD"; exit 1; }
rm -rf node_modules; mkdir -p scripts/floorplan && cp -r "$TOOLS"/. scripts/floorplan/
sed 's/floorplan/project-map/g' "$SKILL/templates/floorplan.config.mjs" | sed '/output: {/,/},/d' > project-map.config.mjs
git init -q -b main && git add -A && git commit -qm old
out=$(node scripts/floorplan/generate-map.mjs --main 2>&1)
has "$out" "docs/PROJECT_MAP.md and docs/project-map.json" "old config name: found, old map paths kept"
mkdir -p .claude && printf '{ "hooks": { "SessionStart": [ { "hooks": [ { "type": "command", "command": "node \\"$CLAUDE_PROJECT_DIR/scripts/project-map/generate-map.mjs\\" --session" } ] } ] } }\n' > .claude/settings.json
node scripts/floorplan/install-hooks.mjs --claude >/dev/null 2>&1
n=$(grep -c "generate-map.mjs" .claude/settings.json); old=$(grep -c "scripts/project-map" .claude/settings.json)
[ "$n" = 2 ] && [ "$old" = 0 ] && ok "install-hooks replaces the old project-map hook entries" || bad "hooks after migration: $n entries, $old old"
printf '# App\n\n<!-- project-map:start old -->\n## Project structure\n@docs/PROJECT_MAP.md\n<!-- project-map:end -->\n\nOwn text.\n' > CLAUDE.md
node scripts/floorplan/claude-md.mjs >/dev/null 2>&1; c=$(cat CLAUDE.md)
if grep -q "project-map:start" <<<"$c"; then bad "old CLAUDE.md section left"; else ok "old CLAUDE.md section replaced"; fi
has "$c" "Own text." "rest of CLAUDE.md kept"

echo "== 25. Windows line endings (CRLF) survive moves and undo"
CR=$TMP/crlf
cp -r "$REPO/sample-spring-app" "$CR" && cd "$CR" || { bad "fixture $CR"; exit 1; }
find src -name "*.java" -exec sed -i.bak 's/$/\r/' {} \; && find src -name "*.bak" -delete
mkdir -p scripts/floorplan && cp -r "$TOOLS"/. scripts/floorplan/ && cp "$SKILL/templates/floorplan.config.spring.mjs" floorplan.config.mjs
git init -q -b main && git -c core.autocrlf=false add -A && git -c core.autocrlf=false commit -qm crlf
out=$(node --input-type=module -e "
  const d = (await import('node:url')).pathToFileURL(process.cwd() + '/scripts/floorplan/').href;
  const fs = await import('node:fs'); const path = await import('node:path');
  const { makeContext } = await import(d + 'lib.mjs'); const { planMove, applyPlan, planUndo } = await import(d + 'move.mjs');
  const { execSync } = await import('node:child_process');
  const lfOnly = () => { let n = 0; const walk = (p) => { for (const e of fs.readdirSync(p, { withFileTypes: true })) { const f = path.join(p, e.name); if (e.isDirectory()) walk(f); else if (f.endsWith('.java') && /[^\r]\n/.test(fs.readFileSync(f, 'utf8'))) n++; } }; walk('src'); return n; };
  const ctx = await makeContext(); let bad = 0;
  for (const [s, t] of [['orders/OrderService.java', 'customers'], ['shared/Money.java', 'orders']]) {
    const r = planMove(ctx, s, t); applyPlan(ctx, r.plan);
    if (lfOnly()) { bad++; console.log('LF lines after moving ' + s); }
    applyPlan(ctx, planUndo(ctx, r.plan.pairs.map(({ from, to }) => ({ from, to }))).plan);
    if (execSync('git -c core.autocrlf=false status --porcelain src', { encoding: 'utf8' })) { bad++; console.log('not restored: ' + s); }
    execSync('git reset -q --hard && git clean -qfd src');
  }
  console.log(bad ? 'crlf broken' : 'crlf kept');" 2>&1)
has "$out" "crlf kept" "Java move keeps CRLF line endings and undo restores CRLF files exactly"

echo
echo "Passed: $PASS   Failed: $FAIL"
[ "$FAIL" -eq 0 ]
