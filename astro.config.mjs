// @ts-check
import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://mpolatcan.github.io',
  markdown: {
    shikiConfig: {
      theme: 'github-dark',
      wrap: true,
    },
  },
});
