// Preset: Angular app sliced by feature (features/<name>, shared/, core/, layout/).
// Use in floorplan.config.mjs: presets: ['angular-feature-sliced']. Your own rules with the same name replace these;
// `severity: 'off'` switches one off.
export default {
  framework: 'angular',
  root: 'src/app',
  units: ['features/*'],
  typeImports: 'warn', // interface-only imports between features: warnings, not errors
  folders: {
    core: { purpose: 'App-wide singletons: auth, HTTP interceptors, global services' },
    shared: { purpose: 'Reusable presentational UI, pipes, directives. No feature logic, no state' },
    layout: { purpose: 'App shell: header, sidebar, footer' },
    'features/*': { purpose: 'Feature area' },
    'features/*/data-access': { purpose: 'API services and state for this feature' },
    'features/*/ui': { purpose: 'Presentational components of this feature' },
  },
  rules: [
    { name: 'layers', type: 'layers', layers: ['features', ['layout', 'core'], 'shared'],
      message: 'features → core/layout → shared: a layer never uses one above it.' },
    { name: 'features-are-isolated', type: 'noImport', from: 'features/*', to: 'features/*', allowSame: true,
      message: 'Features must not import other features. Move shared code to shared/ or core/.',
      why: 'Isolated features can be changed, lazy loaded and deleted on their own.' },
    { name: 'services-placement', type: 'placement', kinds: ['service'], allowedIn: ['core', 'features/*/data-access'],
      message: 'Services belong in core/ (app-wide) or features/<name>/data-access/.' },
    { name: 'no-area-cycles', type: 'noCycles', message: 'Areas depend on each other in a circle.' },
    { name: 'lazy-features-stay-lazy', type: 'lazyBoundary', severity: 'warn' },
    { name: 'aliases-across-areas', type: 'relativeImports', maxUp: 2, severity: 'warn' },
    { name: 'features-are-routed', type: 'routed', folders: 'features/*', severity: 'warn' },
    { name: 'no-store-in-shared', type: 'noPackage', from: 'shared', packages: ['@ngrx/store', '@ngrx/signals'], severity: 'warn',
      message: 'shared/ components get data through inputs, not from the store.' },
    { name: 'no-deep-library-imports', type: 'noPackage', packages: ['rxjs/internal/**', '@angular/*/src/**'],
      message: 'Import libraries through their public entry point.' },
    { name: 'orphan-specs', type: 'orphanTests', severity: 'warn' },
    { name: 'unused-files', type: 'unused', severity: 'warn' },
    { name: 'areas-have-a-purpose', type: 'purpose', folders: 'features/*', severity: 'warn' },
  ],
};
