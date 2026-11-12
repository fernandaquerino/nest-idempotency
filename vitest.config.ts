import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// TEST_DIST=1 runs the e2e suites against the built bundle instead of the sources, to prove
// the published output works inside a real Nest app.
const entry = process.env.TEST_DIST ? './dist/index.mjs' : './src/index.ts';

export default defineConfig({
  // SWC emits decorator metadata, which Nest's DI needs in the test apps.
  plugins: [swc.vite({ module: { type: 'es6' } })],
  resolve: {
    alias: {
      'nest-idempotency': fileURLToPath(new URL(entry, import.meta.url)),
    },
  },
  test: {
    include: ['test/**/*.spec.ts'],
    environment: 'node',
    testTimeout: 15_000,
    setupFiles: ['reflect-metadata'],
  },
});
