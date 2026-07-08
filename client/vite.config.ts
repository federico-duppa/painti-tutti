import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // In dev the game server runs separately on :3001.
      '/socket.io': {
        target: 'http://localhost:3001',
        ws: true,
      },
    },
  },
});
