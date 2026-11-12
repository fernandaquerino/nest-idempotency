import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs', 'esm'],
  dts: true,
  tsconfig: 'tsconfig.build.json',
  sourcemap: true,
  clean: true,
  target: 'node20',
  splitting: false,
  treeshake: true,
  outExtension({ format }) {
    return { js: format === 'cjs' ? '.cjs' : '.mjs' };
  },
  // Peer dependencies are never bundled.
  external: ['@nestjs/common', '@nestjs/core', 'rxjs', 'reflect-metadata', 'ioredis'],
});
