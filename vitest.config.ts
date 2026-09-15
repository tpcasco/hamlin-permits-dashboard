import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
export default defineConfig({ test: { include: ['scripts/__tests__/**/*.test.ts'] }, resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } } });
