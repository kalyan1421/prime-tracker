import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';

export default defineConfig(({ mode }) => {
  // loadEnv (not bare process.env) so API_PORT can live in the gitignored
  // apps/web/.env alongside the other local settings.
  const env = { ...loadEnv(mode, __dirname, ''), ...process.env };

  return {
    plugins: [tailwindcss(), react()],
    resolve: {
      alias: { '@': path.resolve(__dirname, './src') },
    },
    server: {
      port: Number(env.PORT) || 5173,
      allowedHosts: ['.trycloudflare.com'],
      proxy: {
        '/api': {
          // Follows the API's port so this repo can run alongside other local
          // projects that also want 3001. Hardcoding it meant a port clash
          // silently proxied to whatever else was listening — which surfaces as
          // wrong data rather than an honest failure. Default is unchanged.
          target: `http://localhost:${env.API_PORT || 3001}`,
          changeOrigin: true,
        },
      },
    },
  };
});
