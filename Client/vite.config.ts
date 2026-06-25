import { defineConfig } from 'vite';

export default defineConfig({
  // --- DEVELOPMENT SERVER SETTINGS ---
  server: {
    proxy: {
      // Forward standard API calls (Login/Register) to C#
      '/api': {
        target: 'http://localhost:5000',
        changeOrigin: true
      },
      // Forward SignalR Master Node WebSockets
      '/lobbyHub': {
        target: 'http://localhost:5000',
        ws: true 
      },
      // Forward SignalR Worker Node WebSockets
      '/matchHub': {
        target: 'http://localhost:5000',
        ws: true
      }
    }
  },

  // --- PRODUCTION BUILD SETTINGS ---
  build: {
    // This tells Vite to dump the compiled game directly into the .NET server
    outDir: '../Server/wwwroot',
    
    // This ensures old files are deleted before new ones are added
    emptyOutDir: true,
  }
});