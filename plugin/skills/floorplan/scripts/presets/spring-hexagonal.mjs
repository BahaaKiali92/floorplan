// Preset: Spring Boot, hexagonal / ports and adapters: domain ← application ← adapter / infrastructure.
// Package names matched anywhere below root: **/domain, **/application, **/adapter(s), **/infrastructure.
// Use: presets: ['spring-hexagonal'].
export default {
  framework: 'spring',
  rules: [
    { name: 'hexagonal-layers', type: 'layers',
      layers: [['**/adapter', '**/adapters', '**/infrastructure', '**/web', '**/persistence'], ['**/application'], ['**/domain']],
      message: 'Adapters use the application, the application uses the domain, never the other way round.' },
    { name: 'domain-is-framework-free', type: 'noPackage', from: '**/domain',
      packages: ['org.springframework', 'jakarta.persistence', 'javax.persistence', 'com.fasterxml.jackson'],
      message: 'The domain has no framework dependencies.',
      why: 'A framework-free domain is testable in plain unit tests and survives framework upgrades.' },
    { name: 'no-package-cycles', type: 'noCycles' },
    { name: 'constructor-injection', type: 'fieldInjection', severity: 'warn' },
    { name: 'proxy-annotations-on-public-methods', type: 'proxyAnnotations' },
    { name: 'orphan-tests', type: 'orphanTests', severity: 'warn' },
  ],
};
