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

echo "== 8. Spring Boot (Java): map, rules, branch report"
SP=$TMP/spring
cp -r "$REPO/sample-spring-app" "$SP" && cd "$SP"
git init -q -b main && git add -A && git commit -qm sample
mkdir -p scripts/project-map && cp "$TOOLS"/* scripts/project-map/
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
mkdir -p scripts/project-map && cp "$TOOLS"/* scripts/project-map/ && git init -q -b main && git add -A && git commit -qm init
out=$(node scripts/project-map/generate-map.mjs --main 2>&1); has "$out" "5 files · 3 endpoints · 2 areas" "multi-module map"
has "$(cat docs/PROJECT_MAP.md)" "| GET /v1/invoices/{id} | InvoiceResource.get() |" "JAX-RS endpoint"
has "$(cat docs/PROJECT_MAP.md)" "services: InvoiceService, PayInvoice" "custom stereotype (@UseCase meta-annotated with @Service)"
has "$(cat docs/PROJECT_MAP.md)" "- core/src/main/java/com/acme/core/" "single-child package chain on one line"
out=$(node scripts/project-map/move-cli.mjs core/src/main/java/com/acme/core/service/InvoiceService.java api/src/main/java/com/acme/api/web 2>&1)
has "$out" "moves to another module (api)" "warning: move into another module"

echo
echo "Passed: $PASS   Failed: $FAIL"
[ "$FAIL" -eq 0 ]
