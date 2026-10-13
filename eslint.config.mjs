const browserGlobals = {
  document: 'readonly',
  window: 'readonly',
  location: 'readonly',
  fetch: 'readonly',
  console: 'readonly',
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
  setInterval: 'readonly',
  clearInterval: 'readonly',
  requestAnimationFrame: 'readonly',
  cancelAnimationFrame: 'readonly',
  EventSource: 'readonly',
  URL: 'readonly',
  URLSearchParams: 'readonly',
  Blob: 'readonly',
  Promise: 'readonly',
  confirm: 'readonly',
  Set: 'readonly',
  Map: 'readonly',
  navigator: 'readonly',
  ClipboardItem: 'readonly',
  CSS: 'readonly',
  localStorage: 'readonly',
  sessionStorage: 'readonly',
  IntersectionObserver: 'readonly',
  performance: 'readonly',
  crypto: 'readonly',
  TextDecoder: 'readonly',
  btoa: 'readonly',
  FileReader: 'readonly',
  FormData: 'readonly',
  DataTransfer: 'readonly',
  CustomEvent: 'readonly',
  AbortSignal: 'readonly',
  AbortController: 'readonly',
  Event: 'readonly',
  MutationObserver: 'readonly',
  ResizeObserver: 'readonly',
  Node: 'readonly',
  WebSocket: 'readonly',
  requestIdleCallback: 'readonly',
  cancelIdleCallback: 'readonly',
};

const sharedRules = {
  'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
  'no-undef': 'error',
  'eqeqeq': ['error', 'always'],
  'no-var': 'warn',
};

const nodeGlobals = {
  __dirname: 'readonly',
  __filename: 'readonly',
  process: 'readonly',
  console: 'readonly',
  require: 'readonly',
  module: 'readonly',
  exports: 'readonly',
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
  setInterval: 'readonly',
  clearInterval: 'readonly',
  setImmediate: 'readonly',
  clearImmediate: 'readonly',
  URL: 'readonly',
  Buffer: 'readonly',
  global: 'readonly',
  // Node 18+ built-ins used by server.js (Jira fetch proxy endpoint) and by
  // modules/<app-module> (abortable SSE work, the auth runtime test that
  // runs the app's Pages middleware on synthetic Request/Response objects).
  fetch: 'readonly',
  AbortSignal: 'readonly',
  AbortController: 'readonly',
  Request: 'readonly',
  Response: 'readonly',
  URLSearchParams: 'readonly',
};

export default [
  // Ignore test fixtures and module templates — they are not linted by npm run lint.
  { ignores: ['tests/fixtures/**', 'modules-template/**', 'modules/**/node_modules/**', 'catalog/modules/**/node_modules/**'] },
  {
    files: ['server.js', 'scripts/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: nodeGlobals,
    },
    rules: sharedRules,
  },
  {
    files: ['tests/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: nodeGlobals,
    },
    rules: sharedRules,
  },
  {
    files: ['js/**/*.{js,mjs}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: browserGlobals,
    },
    rules: sharedRules,
  },
  // The static presentation page (Settings > Demo). Browser ES modules like
  // js/, plus the few globals the demo engine needs on top of them.
  {
    files: ['demo/**/*.{js,mjs}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...browserGlobals,
        DOMParser: 'readonly',
        matchMedia: 'readonly',
        history: 'readonly',
        getComputedStyle: 'readonly',
        HTMLElement: 'readonly',
        KeyboardEvent: 'readonly',
      },
    },
    rules: sharedRules,
  },
  // Installed modules (modules/<id>/) and the bundled catalog's copies
  // (catalog/modules/<id>/), both linted by `npm run lint:modules` only, never
  // by the core `npm run lint`. A module has three shapes:
  // an ES-module client, a CommonJS server entry and node:test unit tests.
  {
    files: ['modules/*/client/**/*.js', 'catalog/modules/*/client/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: browserGlobals,
    },
    rules: sharedRules,
  },
  {
    files: ['modules/*/server/**/*.js', 'catalog/modules/*/server/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: nodeGlobals,
    },
    rules: sharedRules,
  },
  {
    files: ['modules/*/tests/**/*.{js,mjs}', 'catalog/modules/*/tests/**/*.{js,mjs}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: nodeGlobals,
    },
    rules: sharedRules,
  },
];
