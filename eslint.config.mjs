// ESLint-Konfiguration (Flat Config). Läuft lokal mit `npm run lint` und in der CI.
import js from '@eslint/js';
import globals from 'globals';

export default [
  {ignores: ['data/', 'node_modules/']},
  js.configs.recommended,
  {
    // Bewusst geschluckte Fehler (catch {} als Fallback auf den nächsten Server o. Ä.) sind erlaubt
    rules: {
      'no-unused-vars': ['error', {caughtErrors: 'none'}],
      'no-empty': ['error', {allowEmptyCatch: true}]
    }
  },
  {
    // Browser-Module; die Bibliotheken kommen per <script> aus index.html
    files: ['js/**/*.js'],
    languageOptions: {
      sourceType: 'module',
      globals: {...globals.browser, maplibregl: 'readonly', SunCalc: 'readonly'}
    }
  },
  {
    // Vercel-Funktion (CommonJS)
    files: ['api/**/*.js'],
    languageOptions: {sourceType: 'commonjs', globals: globals.node}
  },
  {
    files: ['test/**/*.mjs', 'eslint.config.mjs'],
    languageOptions: {sourceType: 'module', globals: globals.node}
  }
];
