// Preset: Spring Boot, controller → service → repository (package by feature or by layer; rules use kinds).
// Use: presets: ['spring-layered'] and set root to your base package folder.
export default {
  framework: 'spring',
  rules: [
    { name: 'controllers-use-services', type: 'noImport', fromKinds: ['controller'], toKinds: ['repository'],
      message: 'Controllers call services, not repositories.',
      why: 'Transactions, validation and business rules live in services.' },
    { name: 'repositories-only-from-services', type: 'noImport', fromKinds: ['listener', 'config', 'dto', 'mapper', 'entity'], toKinds: ['repository'],
      message: 'Only services use repositories (controllers: see controllers-use-services).' },
    { name: 'controllers-return-dtos', type: 'noImport', fromKinds: ['controller'], toKinds: ['entity'], severity: 'warn',
      message: 'Controllers should expose DTOs, not JPA entities.',
      why: 'Entities in the API leak lazy-loading and couple the API to the database schema.' },
    { name: 'constructor-injection', type: 'fieldInjection', severity: 'warn' },
    { name: 'proxy-annotations-on-public-methods', type: 'proxyAnnotations' },
    { name: 'no-package-cycles', type: 'noCycles', message: 'Packages depend on each other in a circle.' },
    { name: 'web-stays-out-of-services', type: 'noPackage', kinds: ['service', 'repository', 'entity'],
      packages: ['org.springframework.web.bind.annotation', 'jakarta.servlet', 'javax.servlet'], severity: 'warn',
      message: 'Services and the domain do not know about HTTP.' },
    { name: 'orphan-tests', type: 'orphanTests', severity: 'warn' },
    { name: 'big-classes', type: 'maxSize', maxLines: 800, severity: 'warn' },
  ],
};
