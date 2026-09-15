// @ts-check
import { defineConfig } from 'astro/config';
import preact from '@astrojs/preact';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: process.env.PUBLIC_SITE_URL || 'https://hamlin-tracker.vercel.app',
  output: 'static',
  trailingSlash: 'never',
  integrations: [preact(), sitemap()],
  build: { format: 'file' },
  vite: { ssr: { noExternal: [] } },
});
