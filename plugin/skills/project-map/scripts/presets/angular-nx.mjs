// Preset: Nx workspace with apps/ and libs/. Nx's own depConstraints (eslint) are read automatically as well.
// Use: presets: ['angular-nx'].
export default {
  framework: 'angular',
  root: '.',
  units: ['apps/*', 'libs/*/*', 'libs/*'],
  ignore: ['**/*.spec.ts', '**/environments/**', 'node_modules/**', 'dist/**', '**/test-setup.ts', '**/jest.config.ts'],
  typeImports: 'warn',
  rules: [
    { name: 'apps-are-thin', type: 'noImport', from: 'libs', to: 'apps', message: 'Libraries never import from an app.' },
    { name: 'libs-public-api', type: 'publicApi', modules: ['libs/*/*', 'libs/*'], entry: 'src/index.ts',
      message: 'Use a library through its src/index.ts.' },
    { name: 'no-lib-cycles', type: 'noCycles', message: 'Libraries depend on each other in a circle (Nx cannot build them in order).' },
    { name: 'aliases-across-libs', type: 'relativeImports', maxUp: 3, message: 'Import other libraries through their @scope/name alias.' },
    { name: 'orphan-specs', type: 'orphanTests', severity: 'warn' },
  ],
};
