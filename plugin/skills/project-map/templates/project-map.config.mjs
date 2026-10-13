// Project map configuration. This is the only file you edit by hand.
// The generator reads the real code; here you add what code can't tell:
// what each folder is for, who owns it, and where things are allowed to live.
//
// All paths are relative to `root`. Patterns: '*' = one folder, '**' = any depth.

export default {
  framework: 'angular',
  root: 'src/app',
  tsconfig: 'tsconfig.json',
  output: {
    markdown: 'docs/PROJECT_MAP.md',   // MAIN map, committed, written only by CI on main (npm run map:main)
    json: 'docs/project-map.json',
    local: '.project-map',             // local map + branch report, never committed (the folder ignores itself)
  },

  // Above this many files, a folder shows counts instead of file names (keeps the map small).
  maxFilesPerFolder: 8,

  // "Areas" used for the dependency overview. Everything else is grouped by its first folder.
  units: ['features/*'],

  ignore: ['**/*.spec.ts', '**/environments/**'],

  // Branch report and map:check compare with this branch (origin/<baseBranch> if it exists, else the local one).
  baseBranch: 'main',

  // true: a CI job regenerates the main map after merges (templates/ci). false: someone runs `npm run map:main` on
  // main after merging. Also changes the wording of the CLAUDE.md section (node scripts/project-map/claude-md.mjs).
  ci: true,

  // Sheriff (https://github.com/softarc-consulting/sheriff): if the project has a sheriff.config.ts and
  // @softarc/sheriff-core installed, its module encapsulation and dependency rules are checked too and show up in the
  // map, the graph and map:check (only new issues fail). 'auto' (default), true, or false.
  sheriff: 'auto',

  // Large apps: above compactAbove files the Structure section shows counts per folder instead of file names,
  // compactDepth levels deep (reduced automatically to stay under compactMaxLines), and folders with more than
  // compactWideFolder subfolders list their names on one line. Keeps the map small enough for Claude.
  // compactAbove: 400, compactDepth: 3, compactMaxLines: 250, compactWideFolder: 30,

  // Folder purposes. Exact paths win over wildcard ones.
  folders: {
    'core': { purpose: 'App-wide singletons: auth, HTTP interceptors, global services', owner: 'platform' },
    'shared': { purpose: 'Reusable presentational UI, pipes, directives. No feature logic, no state' },
    'layout': { purpose: 'App shell: header, sidebar, footer' },
    'features': { purpose: 'One folder per business feature, lazy loaded' },
    'features/*': { purpose: 'Feature area' },
    'features/*/data-access': { purpose: 'API services and state for this feature' },
    'features/*/ui': { purpose: 'Presentational components of this feature' },
    // Example of a specific annotation:
    // 'features/orders': { purpose: 'Order list, details and checkout', owner: 'team-orders' },
  },

  rules: [
    {
      name: 'features-are-isolated',
      type: 'noImport',
      from: 'features/*',
      to: 'features/*',
      allowSame: true, // a feature may import its own files
      message: 'Features must not import other features. Move shared code to shared/ or core/.',
    },
    {
      name: 'shared-has-no-feature-deps',
      type: 'noImport',
      from: 'shared',
      to: ['features', 'core'],
      message: 'shared/ must stay generic. It cannot depend on features or core.',
    },
    {
      name: 'services-placement',
      type: 'placement',
      kinds: ['service'], // by kind, so it also works for Angular 20 file names without the .service suffix
      allowedIn: ['core', 'features/*/data-access'],
      // allowComponentScoped: true (default): a service listed in a component's `providers` and placed next to that
      // component is fine there. except: ['legacy/**'] skips files.
      message: 'Services belong in core/ (app-wide) or features/<name>/data-access/.',
    },
    {
      name: 'no-components-in-core',
      type: 'placement',
      files: 'core',
      kinds: ['component'],
      allowedIn: [],
      severity: 'warn',
      message: 'core/ should not contain components. Use layout/ or shared/.',
    },

    // ----- Angular style guide (angular.dev/style-guide). Start as warnings, make them errors once main is clean. -----
    {
      name: 'feature-public-api',
      type: 'publicApi',
      modules: 'features/*', // from outside, import a feature only through its index.ts (if it has one)
      severity: 'warn',
      message: 'Import another feature through its index.ts, not its internal files.',
    },
    {
      name: 'file-names-kebab-case',
      type: 'naming',
      case: 'kebab', // user-profile.ts, user-profile.component.ts
      severity: 'warn',
      message: 'Use hyphens in file names (Angular style guide).',
    },
    {
      name: 'one-angular-class-per-file',
      type: 'oneDeclaration',
      severity: 'warn',
      message: 'One component, directive, pipe or service per file.',
    },
    // Every component/service has a spec next to it. Often noisy in older apps: enable when you want it.
    // { name: 'specs-next-to-code', type: 'companion', kinds: ['component', 'service', 'pipe', 'directive', 'guard'],
    //   companion: '.spec.ts', severity: 'warn', message: 'Unit tests live next to the code they test.' },
  ],
};
