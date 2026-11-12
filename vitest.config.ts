import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  // SWC emits decorator metadata, which Nest's DI needs in the test apps.
  plugins: [swc.vite({ module: { type: 'es6' } })],
  resolve: {
    alias: {
      'nest-idempotency': fileURLToPath(new URL('./src/index.ts', import.meta.url)),
    },
  },
  test: {
    include: ['test/**/*.spec.ts'],
    environment: 'node',
    testTimeout: 15_000,
    setupFiles: ['reflect-metadata'],
  },
});
