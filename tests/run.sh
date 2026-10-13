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
mkdir -p scripts/project-map && cp -r "$TOOLS"/. scripts/project-map/
cp "$REPO/skill/project-map/templates/project-map.config.mjs" .
npm pkg set scripts.map="node scripts/project-map/generate-map.mjs" scripts.map:main="node scripts/project-map/generate-map.mjs --main" \
  scripts.map:check="node scripts/project-map/generate-map.mjs --check" scripts.map:hooks="node scripts/project-map/install-hooks.mjs"
out=$(npm run -s map:main 2>&1); has "$out" "29 files · 7 routes · 7 areas · 2 violations" "main map: counts and 2 seeded violations"
out=$(npm run -s map 2>&1); has "$out" "issues: 0 new, 0 fixed, 2 existing" "local map + branch report on main"
[ -z "$(git status --porcelain .project-map)" ] && ok ".project-map/ ignores itself" || bad ".project-map/ shows up in git status"
out=$(node scripts/project-map/install-hooks.mjs 2>&1); has "$out" "SessionStart hook" "hooks installer (Claude)"; has "$out" "post-checkout" "hooks installer (git)"
node scripts/project-map/install-hooks.mjs >/dev/null 2>&1; n=$(grep -c "project-map/generate-map.mjs" .claude/settings.json); [ "$n" = 2 ] && ok "installer is idempotent (session + edit hook, once each)" || bad "installer added $n hook entries"
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

echo "== 8. Spring Boot (Java): map, rules, branch report"
SP=$TMP/spring
cp -r "$REPO/sample-spring-app" "$SP" && cd "$SP"
git init -q -b main && git add -A && git commit -qm sample
mkdir -p scripts/project-map && cp -r "$TOOLS"/. scripts/project-map/
cp "$REPO/skill/project-map/templates/project-map.config.spring.mjs" project-map.config.mjs
G="node scripts/project-map/generate-map.mjs"
out=$($G --main 2>&1); has "$out" "16 files · 7 endpoints · 6 areas · 6 violations" "main map: counts and 6 seeded issues"
md=$(cat docs/PROJECT_MAP.md)
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
out=$(node scripts/project-map/move-cli.mjs shared/OrderPricingService.java orders 2>&1)
has "$out" "package com.acme.shop.shared; → package com.acme.shop.orders;" "dry run: package declaration"
has "$out" "import com.acme.shop.orders.Order; → (removed: same package now)" "dry run: import becomes same-package"
has "$out" "(added) → import com.acme.shop.shared.Money;" "dry run: import added for the class left behind"
node scripts/project-map/move-cli.mjs shared/OrderPricingService.java orders --apply >/dev/null 2>&1; code $? 0 "apply class move"
compile "compiles after moving a class"
out=$($G --check 2>&1); code $? 0 "check passes after the fix"; has "$out" "2 fixed" "both issues of the misplaced service fixed"
out=$(node scripts/project-map/move-cli.mjs orders/OrderService.java customers --apply 2>&1)
has "$out" "src/test/java/com/acme/shop/customers/OrderServiceTest.java" "test class moves along"
compile "compiles after moving a class used without imports (same package)"
grep -q "^import com.acme.shop.customers.OrderService;" src/main/java/com/acme/shop/orders/OrderController.java && ok "import added where the class was used implicitly" || bad "import not added"
out=$($G --check 2>&1); code $? 1 "moving a service next to a foreign repository: new issues fail"
git reset -q --hard && git clean -qfd src
node scripts/project-map/move-cli.mjs customers orders --apply >/dev/null 2>&1; code $? 0 "apply package move"
[ -f src/main/java/com/acme/shop/orders/customers/CustomerService.java ] && [ ! -d src/main/java/com/acme/shop/customers ] && ok "package moved, old folder removed" || bad "package move layout"
compile "compiles after moving a package"
git reset -q --hard && git clean -qfd src
mkdir -p src/main/resources && printf 'logging:\n  level:\n    com.acme.shop.orders: DEBUG\n' > src/main/resources/application.yml
printf 'package com.acme.shop.orders;\n\nclass OrderNumbers {\n    static String format(Long id) { return "ORD-" + id; }\n}\n' > src/main/java/com/acme/shop/orders/OrderNumbers.java
sed -i.bak 's|return toDto(load(id));|OrderNumbers.format(id);\n        return toDto(load(id));|' src/main/java/com/acme/shop/orders/OrderService.java && rm -f src/main/java/com/acme/shop/orders/*.bak
out=$(node scripts/project-map/move-cli.mjs orders/OrderService.java customers 2>&1)
has "$out" "OrderNumbers is package-private" "warning: package-private class"
out=$(node scripts/project-map/move-cli.mjs orders customers 2>&1)
has "$out" "application.yml:3 mentions com.acme.shop.orders as text" "warning: package named in application.yml"
git reset -q --hard && git clean -qfd src
out=$(node --input-type=module -e "
  const d = process.cwd() + '/scripts/project-map/';
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
out=$(node scripts/project-map/analyze-cli.mjs --list 2>&1); has "$out" "OrderService  (orders/OrderService.java)" "beans listed"
out=$(node scripts/project-map/analyze-cli.mjs --source orders/OrderService.java --methods exportCsv --target-folder orders --class OrderExportService 2>&1)
code $? 3 "blockers → exit 3"
has "$out" 'State "exportCount" is read or written by moving methods and by stats' "shared state blocker"
has "$out" "- formatCsvRow" "private helper moves along"; has "$out" "- lastExportAt" "field moves along"
has "$out" "- OrderRepository (add it to the constructor)" "dependency for the target"
has "$out" "orders/OrderController.java:39  exportCsv" "caller through an injected field"
has "$out" "OrderControllerTest.java" "test with Mockito when/verify"
has "$out" "customerName() is also used by toDto" "shared helper decision"
out=$(node scripts/project-map/analyze-cli.mjs --source orders/OrderService.java --methods cancel --target-file customers/CustomerService.java --json 2>&1)
has "$out" "OrderEventsListener.java" "caller in a Kafka listener"
sed -i.bak 's|    public String stats() {|    public String stats() {\n        cancel(0L);|' src/main/java/com/acme/shop/orders/OrderService.java && rm -f src/main/java/com/acme/shop/orders/*.bak
out=$(node scripts/project-map/analyze-cli.mjs --source orders/OrderService.java --methods cancel --target-file customers/CustomerService.java 2>&1)
has "$out" "has @Transactional and is called by stats inside OrderService" "Spring proxy self-call decision"
git checkout -q -- src
out=$(node scripts/project-map/analyze-cli.mjs --source orders/OrderController.java --methods export --target-file customers/CustomerController.java 2>&1)
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
printf "export default { framework: 'spring', root: '.' };\n" > project-map.config.mjs
mkdir -p scripts/project-map && cp -r "$TOOLS"/. scripts/project-map/ && git init -q -b main && git add -A && git commit -qm init
out=$(node scripts/project-map/generate-map.mjs --main 2>&1); has "$out" "5 files · 3 endpoints · 2 areas" "multi-module map"
has "$(cat docs/PROJECT_MAP.md)" "| GET /v1/invoices/{id} | InvoiceResource.get() |" "JAX-RS endpoint"
has "$(cat docs/PROJECT_MAP.md)" "services: InvoiceService, PayInvoice" "custom stereotype (@UseCase meta-annotated with @Service)"
has "$(cat docs/PROJECT_MAP.md)" "- core/src/main/java/com/acme/core/" "single-child package chain on one line"
out=$(node scripts/project-map/move-cli.mjs core/src/main/java/com/acme/core/service/InvoiceService.java api/src/main/java/com/acme/api/web 2>&1)
has "$out" "moves to another module (api)" "warning: move into another module"

echo "== 12. Angular: style guide rules, component-scoped services, Angular 20 names, near misses"
NG=$TMP/ng2
cp -r "$REPO/sample-app" "$NG" && cd "$NG"
printf 'node_modules\n' > .gitignore
mkdir -p node_modules && ln -s "$APP/node_modules/typescript" node_modules/typescript
mkdir -p scripts/project-map && cp -r "$TOOLS"/. scripts/project-map/ && cp "$REPO/skill/project-map/templates/project-map.config.mjs" .
git init -q -b main && git add -A && git commit -qm sample
G="node scripts/project-map/generate-map.mjs"
out=$($G --main 2>&1); has "$out" "29 files · 7 routes · 7 areas · 2 violations" "style-guide rules add nothing on a clean sample"
has "$(cat docs/PROJECT_MAP.md)" "(project-map $(cat "$TOOLS/VERSION"))" "map header shows the tool version"
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
kinds=$(node -e "const d=require('./.project-map/project-map.json');console.log(d.files.filter(f=>/order-summary\/|auth\/admin/.test(f.path)).map(f=>f.name+':'+f.kind).join(' '))")
has "$kinds" "order-summary:component" "Angular 20 file name: component from @Component"
has "$kinds" "order-totals:service" "Angular 20 file name: service from @Injectable"
has "$kinds" "admin:guard" "functional guard (CanActivateFn)"
out=$($G --check 2>&1); has "$out" "features/orders/order-summary/order-totals.ts must be in core or features/*/data-access" "placement by kind works without .service suffix"
# near miss: util/ vs utils/
mkdir -p src/app/shared/util
printf "export const sum = (a: number, b: number) => a + b;\n" > src/app/shared/util/sum.ts
cat > project-map.config.mjs.extra <<'JS'
JS
node -e "
const fs=require('fs');let c=fs.readFileSync('project-map.config.mjs','utf8');
c=c.replace(\"  rules: [\", \"  rules: [\n    { name: 'helpers-in-utils', type: 'placement', files: 'shared/**', kinds: ['other'], allowedIn: ['**/utils', 'shared/ui', 'shared/pipes', 'shared/directives'], message: 'Helpers live in a utils/ folder.' },\n    { name: 'naming-test', type: 'naming', case: 'kebab', message: 'kebab' },\");
fs.writeFileSync('project-map.config.mjs',c);"
rm -f project-map.config.mjs.extra
printf "export const x = 1;\n" > src/app/shared/ui/MyHelper.ts
out=$($G --check 2>&1)
has "$out" '(folder "util/": did you mean "utils/"?)' "near-miss hint for util/ vs utils/"
has "$out" 'file name "MyHelper" is not kebab-case' "naming rule"
printf "import { Component, Injectable } from '@angular/core';\n@Injectable()\nexport class A {}\n@Component({ selector: 'x', template: '' })\nexport class B {}\n" > src/app/shared/ui/two-things.ts
out=$($G 2>&1); has "$(cat .project-map/PROJECT_MAP.md)" "shared/ui/two-things.ts\` declares 2 Angular classes — one-angular-class-per-file" "one declaration per file"
git checkout -q -- . && git clean -qfd src

echo "== 13. Angular: public API rule and Sheriff"
printf "export { CustomerAvatarComponent } from './ui/customer-avatar/customer-avatar.component';\n" > src/app/features/customers/index.ts
out=$($G 2>&1); has "$(cat .project-map/PROJECT_MAP.md)" "features/orders/order-detail/order-detail.component.ts\` imports features/customers/ui/customer-avatar/customer-avatar.component.ts — feature-public-api" "deep import into a feature with an index.ts"
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
  out=$($G --main 2>&1); has "$(cat docs/PROJECT_MAP.md)" "sheriff:encapsulation" "Sheriff violations in the main map"
  has "$(cat docs/PROJECT_MAP.md)" "deep import ../../customers/ui/customer-avatar/customer-avatar.component" "Sheriff deep import named"
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
printf '# Team\r\n\r\n## Project structure\r\n\r\n@docs/PROJECT_MAP.md\r\n\r\n- old\r\n\r\n## Other\r\n\r\nKeep.\r\n' > CLAUDE.md
out=$(node scripts/project-map/claude-md.mjs --no-ci 2>&1); has "$out" "replaced the older section" "older section replaced"; has "$out" "CRLF kept" "CRLF kept"
grep -q "Keep." CLAUDE.md && grep -q "there is no CI job" CLAUDE.md && ok "rest of CLAUDE.md kept, no-CI wording" || bad "CLAUDE.md content"
[ "$(grep -c $'\r$' CLAUDE.md)" = "$(wc -l < CLAUDE.md)" ] && ok "every line still CRLF" || bad "mixed line endings"
out=$(node scripts/project-map/claude-md.mjs --no-ci 2>&1); has "$out" "up to date" "idempotent"
printf 'docs/\n' >> .gitignore
out=$($G --main 2>&1); has "$out" "is ignored by git" "warns when the main map folder is gitignored"
git checkout -q -- .gitignore
out=$($G --outputs); has "$out" "docs/PROJECT_MAP.md docs/project-map.json" "--outputs for CI templates"
out=$(git switch -q -c feat/x && $G --main 2>&1); has "$out" "The main map describes main" "warns when --main runs on a branch"

echo "== 15. Per-edit hook, fixes, PR comment, cache"
SP2=$TMP/spring2
cp -r "$REPO/sample-spring-app" "$SP2" && cd "$SP2"
mkdir -p scripts/project-map && cp -r "$TOOLS"/. scripts/project-map/ && cp "$REPO/skill/project-map/templates/project-map.config.spring.mjs" project-map.config.mjs
git init -q -b main && git add -A && git commit -qm sample
G="node scripts/project-map/generate-map.mjs"
$G --main >/dev/null 2>&1 && git add -A && git commit -qm map
out=$($G --main 2>&1); has "$out" "fix: node scripts/project-map/move-cli.mjs shared/OrderPricingService.java orders" "fix suggestion: the feature the class uses"
[ -f .project-map/cache-spring.json ] && ok "per-file cache written (.project-map/)" || bad "no cache file"
m1=$(md5sum < docs/PROJECT_MAP.md); $G --main >/dev/null 2>&1; m2=$(md5sum < docs/PROJECT_MAP.md); [ "$m1" = "$m2" ] && ok "cached run gives the same map" || bad "cached map differs"
git switch -q -c feature/hook
printf 'package com.acme.shop.config;\n\nimport com.acme.shop.customers.CustomerRepository;\nimport org.springframework.stereotype.Service;\n\n@Service\npublic class ExtraService {\n    private final CustomerRepository repo;\n    public ExtraService(CustomerRepository r) { this.repo = r; }\n}\n' > src/main/java/com/acme/shop/config/ExtraService.java
out=$(printf '{"tool_name":"Write","tool_input":{"file_path":"%s/src/main/java/com/acme/shop/config/ExtraService.java"}}' "$SP2" | CLAUDE_PROJECT_DIR="$SP2" $G --hook)
has "$out" '"hookEventName":"PostToolUse"' "hook answers with PostToolUse context"
has "$out" "config/ExtraService.java breaks a structure rule" "hook names the file and the issue"
has "$out" "move-cli.mjs config/ExtraService.java customers" "hook suggests the fix (uses customers)"
out=$(printf '{"tool_name":"Write","tool_input":{"file_path":"%s/src/main/java/com/acme/shop/orders/OrderDto.java"}}' "$SP2" | CLAUDE_PROJECT_DIR="$SP2" $G --hook); [ -z "$out" ] && ok "hook is silent for a clean file" || bad "hook spoke for a clean file" "$out"
out=$(echo 'not json' | CLAUDE_PROJECT_DIR="$SP2" $G --hook); code $? 0 "hook never fails"
out=$(node scripts/project-map/move-cli.mjs config/ExtraService.java --fix --apply 2>&1); has "$out" "Fix for services-in-features: move to customers/" "move-cli --fix"
[ -f src/main/java/com/acme/shop/customers/ExtraService.java ] && ok "--fix moved the class" || bad "--fix did not move"
out=$(node scripts/project-map/move-cli.mjs customers/ExtraService.java billing 2>&1); has "$out" "add --create" "missing target folder: hint for --create"
out=$(node scripts/project-map/move-cli.mjs customers/ExtraService.java billing --create --apply 2>&1); code $? 0 "--create makes the new package"
grep -q "^package com.acme.shop.billing;" src/main/java/com/acme/shop/billing/ExtraService.java && ok "class in the new package" || bad "new package"
cp src/main/java/com/acme/shop/customers/CustomerService.java src/main/java/com/acme/shop/config/X2Service.java
sed -i.bak 's/package com.acme.shop.customers;/package com.acme.shop.config;\nimport com.acme.shop.customers.*;/; s/CustomerService/X2Service/g' src/main/java/com/acme/shop/config/X2Service.java && rm -f src/main/java/com/acme/shop/config/*.bak
$G --check --pr-comment "$TMP/pr.md" >/dev/null 2>&1; code $? 1 "check with --pr-comment still fails on new issues"
pr=$(cat "$TMP/pr.md")
has "$pr" "<!-- project-map -->" "PR comment marker"
has "$pr" "**New rule issues (the check fails)**" "PR comment: new issues section"
has "$pr" "move-cli.mjs config/X2Service.java --fix --apply" "PR comment: fix command"
has "$pr" "New dependencies between areas" "PR comment: area dependencies"
git reset -q --hard && git clean -qfd src && git switch -q main
out=$(node scripts/project-map/install-hooks.mjs --claude 2>&1); has "$out" "edit check (PostToolUse)" "installer adds the edit check"
grep -q '"matcher": "Write|Edit|MultiEdit"' .claude/settings.json && grep -q -- "--hook" .claude/settings.json && ok "PostToolUse hook in settings" || bad "PostToolUse hook missing"

echo "== 16. Split map, Nx, ArchUnit"
node -e "const fs=require('fs');let c=fs.readFileSync('project-map.config.mjs','utf8');fs.writeFileSync('project-map.config.mjs',c.replace(\"framework: 'spring',\",\"framework: 'spring',\n  split: true,\"))"
out=$($G --main 2>&1); md=$(cat docs/PROJECT_MAP.md)
has "$md" "## Areas" "split view: overview with areas"
has "$md" "project-map-areas/orders.md" "split view: link to the area file"
has "$(cat docs/project-map-areas/orders.md)" "# Area orders" "area detail file"
has "$(cat docs/project-map-areas/orders.md)" "| GET /api/orders/{id} |" "area file has its endpoints"
has "$($G --outputs)" "docs/project-map-areas" "--outputs includes the area folder"
git checkout -q -- project-map.config.mjs && rm -rf docs/project-map-areas
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
has "$(cat docs/PROJECT_MAP.md)" "rule(s) from ArchUnit tests" "ArchUnit listed under Rules"
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
printf "export default { framework: 'angular', root: '.', units: ['libs/*'] };\n" > project-map.config.mjs
mkdir -p scripts/project-map && cp -r "$TOOLS"/. scripts/project-map/ && git init -q -b main && git add -A && git commit -qm nx
out=$(node scripts/project-map/generate-map.mjs --main 2>&1)
has "$out" "libs/a/src/lib/a.ts imports libs/b/src/index.ts (a [scope:a] → b [scope:b]: scope:a may only depend on scope:a, scope:shared)" "Nx depConstraints (flat ESLint config)"
has "$out" "1 violations" "Nx: allowed dependency on shared not reported"

echo "== 17. Graph server: Host, Origin and token checks, file shapes"
cd "$APP"
out=$(node - "$APP" <<'JS' 2>&1
const { spawn } = require('node:child_process');
const port = 4300 + Math.floor(Math.random() * 500);
const srv = spawn(process.execPath, ['scripts/project-map/server.mjs', '--port', String(port)], { cwd: process.argv[2], stdio: 'ignore' });
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
  console.log('with-token', await st('/api/map', { 'x-project-map-token': token }));
  console.log('wrong-token', await st('/api/map', { 'x-project-map-token': 'x'.repeat(token.length) }));
  console.log('foreign-origin', await st('/api/undo', { 'x-project-map-token': token, origin: 'http://evil.example' }, 'POST'));
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

echo
echo "Passed: $PASS   Failed: $FAIL"
[ "$FAIL" -eq 0 ]
