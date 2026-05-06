import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Base path matches the GitHub repo name. Update to '/' when a custom domain is added.
  base: '/cta-alert-history/',
});
