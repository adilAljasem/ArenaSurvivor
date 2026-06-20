import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    // This tells Vite to dump the compiled game directly into the .NET server
    outDir: '../Server/wwwroot',
    
    // This ensures old files are deleted before new ones are added
    emptyOutDir: true,
  }
});