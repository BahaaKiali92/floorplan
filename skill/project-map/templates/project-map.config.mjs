// Project map configuration. This is the only file you edit by hand.
// The generator reads the real code; here you add what code can't tell:
// what each folder is for, who owns it, and where things are allowed to live.
//
// All paths are relative to `root`. Patterns: '*' = one folder, '**' = any depth.

export default {
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
      files: '**/*.service.ts',
      allowedIn: ['core', 'features/*/data-access'],
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
  ],
};
