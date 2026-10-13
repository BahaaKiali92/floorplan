# 4 · Spring Boot (Java)

Everything that is different for Spring Boot projects. The ideas are the same as for Angular (main map by CI, branch
report, a check that fails only on new issues, the bubble graph, method-move preview); this page covers setup,
what the generator understands in Java code, what a class or package move rewrites, the Spring-specific checks, and a
walkthrough with `sample-spring-app/`.

Contents:
1. [Requirements](#1-requirements)
2. [Setup](#2-setup)
3. [The config: root, kinds, rules](#3-the-config)
4. [What the map shows](#4-what-the-map-shows)
5. [Moving classes and packages](#5-moving-classes-and-packages)
6. [Moving methods between Spring beans](#6-moving-methods-between-spring-beans)
7. [Commands](#7-commands)
8. [Validate with the sample app](#8-validate-with-the-sample-app)
9. [Limits](#9-limits)

---

## 1. Requirements

| Need | Why |
|---|---|
| Claude Code | runs the skill |
| Node.js 18+ | runs the tools. Yes, also in a Java project: the tools are plain Node scripts with no dependencies |
| Maven or Gradle project with Java sources in `src/main/java` | what gets mapped |
| git | branch report, `git mv`, undo |

Not needed: a JDK, a build, Maven/Gradle, network. The tools read the source code directly, so the map and the check
also work in CI jobs that don't build the project. (You do compile and test after a move, as always.)

## 2. Setup

In Claude Code, from the folder with the root `pom.xml` / `build.gradle`:

```
/project-map setup
```

Claude detects Spring Boot, copies the tools to `scripts/project-map/`, proposes `project-map.config.mjs` (you confirm
the package purposes and rules), adds the Spring section to `CLAUDE.md`, generates the first maps, and asks about the
automatic refresh and CI. No `package.json` is added; every command is `node scripts/project-map/<tool>.mjs`.

CI templates are the same as for Angular (they only need Node). If your pipeline runs in a Maven/Gradle image without
Node, keep the template's own job (it uses a Node image) or add Node to the image.

## 3. The config

```js
export default {
  framework: 'spring',
  root: 'src/main/java/com/acme/shop',   // one module: the base package folder
  // root: '.',                          // several modules: the repository (paths start with the module)
  folders: { orders: { purpose: 'Orders: REST API, business logic, persistence', owner: 'team-orders' } },
  rules: [ /* see below */ ],
};
```

**Root.** With one module, use the folder of the base package (the package of the `@SpringBootApplication` class).
Paths then read like packages: `orders/OrderService.java`, and patterns are short (`orders`, `*`). With several
modules, use `'.'`: paths start with the module, and the map shows a chain like
`billing/src/main/java/com/acme/billing/` as one line. Tests (`src/test/java`) are not part of the map, but they
are read for moves and for the method analysis, and counted.

**Kinds.** Every class gets a kind from its annotations and name. Rules can use kinds:

| Kind | Recognized by |
|---|---|
| `application` | `@SpringBootApplication` |
| `controller` | `@RestController`, `@Controller`, `@(Rest)ControllerAdvice`, JAX-RS resources (`@Path`) |
| `repository` | `@Repository`, an interface extending `…Repository`, name ending `Repository` |
| `entity` | `@Entity`, `@Embeddable`, `@MappedSuperclass`, `@Document` |
| `config` | `@Configuration`, `@ConfigurationProperties`, `@AutoConfiguration`, `@EnableWebSecurity` |
| `mapper` | `@Mapper` (MapStruct), name ending `Mapper` |
| `service` | `@Service`, or a class named `…Service` / `…ServiceImpl` |
| `listener` | `@KafkaListener`, `@RabbitListener`, `@JmsListener`, `@SqsListener`, `@ServiceBusListener`, or a name ending `Listener`/`Consumer` |
| `component` | `@Component` |
| `exception` | name ending `Exception`/`Error`, or extends an exception |
| `dto` | name ending `Dto`, `Request`, `Response`, `Command`, `Payload`, `Event`, `View`, `Form`, `Resource` |
| `model` | enums and records (value objects) |
| `annotation`, `interface`, `other` | the rest |

Your own stereotypes count too: a project annotation like `@UseCase` that is itself annotated with `@Service` or
`@Component` gives its classes that kind.

**Rules.** The same two rule types as for Angular (`noImport`, `placement`), plus kind filters:

| Field | Rule type | Meaning |
|---|---|---|
| `fromKinds` | noImport | only classes of these kinds are checked |
| `toKinds` | noImport | only dependencies on classes of these kinds count |
| `exceptFrom` | noImport | files matching these patterns are not checked |
| `kinds` | placement | only classes of these kinds must be in `allowedIn` |
| `from` / `to` / `files` | both | optional now; default: everything |

"Import" means any dependency between two classes: an `import`, a wildcard import that is used, a class used from the
same package without an import, or a fully qualified name in code.

The template has rules for the common layouts:

```js
// every layout
{ name: 'controllers-use-services', type: 'noImport', fromKinds: ['controller'], toKinds: ['repository'],
  message: 'Controllers call services, not repositories.' },
{ name: 'controllers-return-dtos', type: 'noImport', fromKinds: ['controller'], toKinds: ['entity'], severity: 'warn',
  message: 'Controllers should expose DTOs, not JPA entities.' },
// package by feature
{ name: 'no-foreign-internals', type: 'noImport', from: '*', to: '*', allowSame: true, exceptFrom: ['shared', 'config'],
  toKinds: ['repository', 'entity'], message: 'Use another feature through its service, not its repositories or entities.' },
{ name: 'services-in-features', type: 'placement', kinds: ['service'], allowedIn: ['orders', 'customers'],
  message: 'Services belong to a feature package.' },
// package by layer
{ name: 'controllers-in-web', type: 'placement', kinds: ['controller'], allowedIn: ['web', 'controller'] },
// hexagonal
{ name: 'domain-is-pure', type: 'noImport', from: 'domain', to: ['adapter', 'config'] },
```

## 4. What the map shows

Same sections as for Angular, with Java content:

- **Header**: `Spring Boot (Java) · 16 source files · 2 test files` and a count per kind.
- **Structure**: packages with their purpose and classes per kind.
- **HTTP endpoints and listeners** (instead of Routes): `GET /api/orders/{id} | OrderController.get()`, built from
  class-level `@RequestMapping` plus `@GetMapping`/`@PostMapping`/…, or JAX-RS `@Path` plus `@GET`/`@POST`/…; message listeners (`KAFKA payments.failed`,
  `RABBIT …`, `JMS …`, `SERVICEBUS …`) and `@Scheduled` methods.
- **Dependencies between areas**, **Rules**, **Violations**.
- **Main libraries**: the most imported external packages (`org.springframework.web`, `jakarta.persistence`, …).

The branch report, the session summary and the check work exactly as for Angular.

## 5. Moving classes and packages

In the graph (drag a class or package onto a package) or with the CLI:

```bash
node scripts/project-map/move-cli.mjs shared/OrderPricingService.java orders          # dry run
node scripts/project-map/move-cli.mjs shared/OrderPricingService.java orders --apply  # do it
node scripts/project-map/move-cli.mjs customers orders --apply                         # a whole package
```

What is rewritten:

| Change | Example |
|---|---|
| package declaration of each moved class | `package com.acme.shop.shared;` → `package com.acme.shop.orders;` |
| imports of the moved classes everywhere (single, static, wildcard) | `import com.acme.shop.orders.OrderService;` → `import com.acme.shop.customers.OrderService;` |
| classes that used each other **without an import** (same package) | `OrderController` gets `import com.acme.shop.customers.OrderService;` |
| the moved class's own same-package uses | the moved class gets imports for the classes it left behind |
| imports that became unnecessary | `import com.acme.shop.orders.Order;` removed when the class moves into `orders` |
| wildcard imports of a package that moved completely | `import com.acme.shop.orders.*;` → `…customers.orders.*;` |
| fully qualified names in code | `com.acme.shop.orders.OrderStatus.NEW` |
| tests | `OrderServiceTest`, `OrderServiceTests`, `OrderServiceIT` move to the mirrored package in `src/test/java`; a package move takes its test package along |

New imports are placed in sorted position in the existing import block. Files move with `git mv`. Empty package
folders are removed (never `src/main/java` itself). Undo restores every file exactly.

Warnings (shown in the preview; the tool doesn't change these):

- **Text mentions**: the old class or package name in a string (`"com.acme.shop.orders.OrderService"`),
  `application.yml` / `.properties` (`logging.level.com.acme.shop.orders`), XML, Gradle files.
- **Package-private access**: a class without `public` that is now used across the new package boundary.
- **Component scan**: a bean, repository or entity that leaves the package of the `@SpringBootApplication` class
  (Spring would no longer find it without extra configuration).
- **Another module**: the target is in another Maven/Gradle module; check that module's dependencies.
- **Resources**: `src/main/resources/<same package path>` exists (e.g. MyBatis XML); move it yourself if needed.
- **Name clash**: the target package has a class with the same name as one the moved class imports.

Refused: moving into a folder outside `src/<set>/java`, invalid package names, a package into itself, a target that
already exists.

After a move: compile (`./mvnw -q -DskipTests compile test-compile` or `./gradlew compileJava compileTestJava`), then
the check. Package-private **members** (fields, methods) used across the new boundary are only found by compiling.

## 6. Moving methods between Spring beans

Open a `@Service` / `@Component` / controller / listener in the graph, select methods, drop them on another bean or on
a package (new class). Or:

```bash
node scripts/project-map/analyze-cli.mjs --list
node scripts/project-map/analyze-cli.mjs --source orders/OrderService.java --methods exportCsv \
  --target-folder orders --class OrderExportService
```

The analysis reads the Java code directly (no build): fields, constructor injection (also `@Autowired`, `@Value`),
which methods and fields each method uses, and callers in every class of the project, including tests.

Callers are found through: injected fields and constructor parameters of the source type (or an interface it
implements), local variables, static calls, method references (`orderService::exportCsv`), and Mockito
`when(x.m())`, `verify(x).m()`, `doReturn(…).when(x).m()`.

Same results as for Angular (methods, helpers and fields that move along, dependencies for the target, callers,
tests, dependency direction, circular dependency), plus Spring decisions:

| Decision | When |
|---|---|
| Shared state (blocker) | a mutable field is used by moving and remaining methods. Beans are singletons, so splitting changes shared state |
| Proxy self-call | a `@Transactional` / `@Cacheable` / `@Async` / `@PreAuthorize` … method is called inside the source class. Today those calls skip the Spring proxy; after the move they go through it (e.g. a real new transaction) |
| Class-level annotation | the source class is `@Transactional` (or similar), the target isn't |
| Interface method | the method is declared in an interface the source implements; callers through the interface still reach the source |
| HTTP endpoint | moving a controller method changes its URL if the class-level `@RequestMapping` differs |
| Shared constant | a `static final` used by moving and remaining methods |
| Circular dependency (blocker) | both beans would inject each other: Spring fails at startup with constructor injection |

Overloads are treated as one method (moved together). "Copy task for Claude" gives a Spring-specific task:
constructor injection, Maven/Gradle test commands, the decisions to ask about.

## 7. Commands

| What | Command |
|---|---|
| Local map + branch report | `node scripts/project-map/generate-map.mjs` |
| Check (only new issues fail) | `node scripts/project-map/generate-map.mjs --check` (`--strict`: all issues) |
| Main map (CI on main) | `node scripts/project-map/generate-map.mjs --main` |
| Graph | `node scripts/project-map/server.mjs` → http://localhost:4321 |
| Move | `node scripts/project-map/move-cli.mjs <source> <target-package-folder> [--apply]` |
| Method analysis | `node scripts/project-map/analyze-cli.mjs --list` / `--source … --methods … (--target-file … \| --target-folder … --class …)` |
| Hooks | `node scripts/project-map/install-hooks.mjs` (`--git` per clone) |

## 8. Validate with the sample app

`sample-spring-app/` is a small Maven project (orders, customers, notifications, shared, config) with seeded issues.
`java-stubs/` has tiny stand-ins for the Spring, JPA, JUnit and Mockito annotations so you can compile it with plain
`javac` (no Maven, no network).

```bash
cp -r sample-spring-app /tmp/spring && cd /tmp/spring
git init -q -b main && git add -A && git commit -qm sample
mkdir -p scripts/project-map && cp <kit>/skill/project-map/scripts/* scripts/project-map/
cp <kit>/skill/project-map/templates/project-map.config.spring.mjs project-map.config.mjs
node scripts/project-map/generate-map.mjs --main
```

Expected: `16 files · 7 endpoints · 6 areas · 6 violations`:

| Issue | Rule |
|---|---|
| `orders/OrderController` uses `OrderRepository` | controllers-use-services |
| `customers/CustomerController` returns the `Customer` entity (warning) | controllers-return-dtos |
| `orders/OrderService` uses `Customer` and `CustomerRepository` of another feature (2) | no-foreign-internals |
| `shared/OrderPricingService` depends on `orders` | shared-has-no-feature-deps |
| `shared/OrderPricingService` is a service outside a feature | services-in-features |

Then:

```bash
git add -A && git commit -qm setup && git switch -c try
node scripts/project-map/move-cli.mjs shared/OrderPricingService.java orders          # preview: package line, 1 import removed, 1 added
node scripts/project-map/move-cli.mjs shared/OrderPricingService.java orders --apply
node scripts/project-map/generate-map.mjs --check                                     # ✓ No new rule issues. 2 fixed
javac -d /tmp/classes $(find <kit>/java-stubs src -name '*.java')                     # compiles
node scripts/project-map/analyze-cli.mjs --source orders/OrderService.java --methods exportCsv \
  --target-folder orders --class OrderExportService                                   # exit 3: exportCount is shared state
node scripts/project-map/server.mjs                                                   # the graph
```

The repository's `tests/run.sh` runs all of this automatically (sections 8 to 11) and compiles after every move.

## 9. Limits

Tested on real projects: spring-petclinic (50 files), buckpal (hexagonal, 46 files) and Apache Fineract
(29 modules, 5,476 classes: map in 2.5 s, 25 KB; method analysis and package move preview under 3 s).


- Java only. Kotlin files are not read (a mixed project gets a map of its Java part).
- Parsing is done by the tool itself (no compiler), which is fast and needs no build, but it does not resolve types
  like the compiler. Callers are found by declared type names; a call through a variable declared with `var` or
  through a generic helper may be missed. The task always ends with "compile and run the tests".
- Package-private members used across a new package boundary are found by compiling, not by the preview.
- Strings, YAML, XML and Gradle files are reported, never rewritten.
- Reflection, Spring Expression Language (`@{orderService.x()}`) and XML bean definitions are not analyzed.
- Moving a class to another module changes nothing in `pom.xml` / `build.gradle`.
