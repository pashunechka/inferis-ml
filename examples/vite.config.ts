import { resolve } from 'path';
import { defineConfig } from 'vite';

export default defineConfig({
  base: process.env.VITE_BASE || '/',
  resolve: {
    alias: {
      '@huggingface/transformers': resolve(__dirname, 'node_modules/@huggingface/transformers'),
      '@mlc-ai/web-llm': resolve(__dirname, 'node_modules/@mlc-ai/web-llm'),
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
        embeddings: resolve(__dirname, 'embeddings.html'),
        generation: resolve(__dirname, 'generation.html'),
        index: resolve(__dirname, 'index.html'),
        llm: resolve(__dirname, 'llm.html'),
        ner: resolve(__dirname, 'ner.html'),
        priority: resolve(__dirname, 'priority.html'),
        qa: resolve(__dirname, 'qa.html'),
        sentiment: resolve(__dirname, 'sentiment.html'),
        vision: resolve(__dirname, 'vision.html'),
      },
    },
  },
  optimizeDeps: {
    exclude: ['inferis-ml'],
  },
});
