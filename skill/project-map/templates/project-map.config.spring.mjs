// Project map configuration for a Spring Boot (Java) project. This is the only file you edit by hand.
// The generator reads the real code; here you add what code can't tell:
// what each package is for, who owns it, and where things are allowed to live.
//
// All paths are relative to `root` (folders = packages). Patterns: '*' = one folder, '**' = any depth.
// Kinds the generator recognizes (from annotations and names): application, controller, service, repository,
// entity, dto, mapper, config, component, listener, exception, model, interface, other.

export default {
  framework: 'spring',

  // Single module: the base package folder, so paths read like packages (orders/OrderService.java).
  // Several Maven/Gradle modules: '.' (the repository), and use module names in the patterns below.
  root: 'src/main/java/com/acme/shop',

  output: {
    markdown: 'docs/PROJECT_MAP.md',   // MAIN map, committed, written only by CI on main
    json: 'docs/project-map.json',
    local: '.project-map',             // local map + branch report, never committed (the folder ignores itself)
  },

  // Above this many files, a folder shows counts instead of class names (keeps the map small).
  maxFilesPerFolder: 8,

  // "Areas" used for the dependency overview. Default: the first folder under root (a feature or layer package).
  // units: ['modules/*'],

  ignore: ['**/package-info.java', '**/module-info.java'],

  // Branch report and map:check compare with this branch (origin/<baseBranch> if it exists, else the local one).
  baseBranch: 'main',

  // compactAbove: 400, compactDepth: 3, compactMaxLines: 250, compactWideFolder: 30,

  // Package purposes. Exact paths win over wildcard ones.
  folders: {
    'config': { purpose: 'Spring configuration: beans, security, web, clients' },
    'shared': { purpose: 'Small generic building blocks (value objects, exceptions). No feature logic, no beans' },
    'orders': { purpose: 'Orders: REST API, business logic, persistence', owner: 'team-orders' },
    'customers': { purpose: 'Customers: REST API, business logic, persistence' },
    'notifications': { purpose: 'Message listeners that react to events from other systems' },
  },

  rules: [
    // ----- layers (work for package-by-feature and package-by-layer) -----
    {
      name: 'controllers-use-services',
      type: 'noImport',
      fromKinds: ['controller'],
      toKinds: ['repository'],
      message: 'Controllers call services, not repositories.',
    },
    {
      name: 'controllers-return-dtos',
      type: 'noImport',
      fromKinds: ['controller'],
      toKinds: ['entity'],
      severity: 'warn',
      message: 'Controllers should expose DTOs, not JPA entities.',
    },

    // ----- package by feature -----
    {
      name: 'no-foreign-internals',
      type: 'noImport',
      from: '*',
      to: '*',
      allowSame: true, // a feature may use its own repositories and entities
      exceptFrom: ['shared', 'config'],
      toKinds: ['repository', 'entity'],
      message: 'Use another feature through its service, not its repositories or entities.',
    },
    {
      name: 'shared-has-no-feature-deps',
      type: 'noImport',
      from: 'shared',
      to: ['orders', 'customers', 'notifications'],
      message: 'shared/ must stay generic. It cannot depend on features.',
    },
    {
      name: 'services-in-features',
      type: 'placement',
      kinds: ['service'],
      allowedIn: ['orders', 'customers', 'notifications'],
      message: 'Services belong to a feature package, not to shared/ or config/.',
    },

    // ----- package by layer: use these instead of the feature rules -----
    // { name: 'controllers-in-web', type: 'placement', kinds: ['controller'], allowedIn: ['web', 'controller'],
    //   message: 'Controllers belong in web/.' },
    // { name: 'repositories-in-persistence', type: 'placement', kinds: ['repository'], allowedIn: ['repository', 'persistence'],
    //   message: 'Repositories belong in repository/.' },
    // { name: 'domain-has-no-web', type: 'noImport', from: 'domain', toKinds: ['controller', 'dto'],
    //   message: 'The domain must not depend on the web layer.' },
  ],
};
