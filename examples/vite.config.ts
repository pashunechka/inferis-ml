import { resolve } from 'path';
import { defineConfig } from 'vite';

export default defineConfig({
  resolve: {
    alias: {
      '@huggingface/transformers': resolve(__dirname, 'node_modules/@huggingface/transformers'),
    },
  },
  server: {
    fs: {
      allow: ['..'],
    },
  },
  worker: {
    format: 'es',
  },
  build: {
    rollupOptions: {
      input: {
        capabilities: resolve(__dirname, 'capabilities.html'),
        embeddings: resolve(__dirname, 'embeddings.html'),
        generation: resolve(__dirname, 'generation.html'),
        index: resolve(__dirname, 'index.html'),
        sentiment: resolve(__dirname, 'sentiment.html'),
        vision: resolve(__dirname, 'vision.html'),
      },
    },
  },
  optimizeDeps: {
    exclude: ['inferis'],
  },
});