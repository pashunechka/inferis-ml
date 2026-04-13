import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: {
      index: 'src/index.ts',
      'adapters/transformers': 'src/adapters/transformers.ts',
      'adapters/web-llm': 'src/adapters/web-llm.ts',
      'adapters/onnx': 'src/adapters/onnx.ts',
      'worker/dedicated.worker': 'src/worker/dedicated.worker.ts',
    },
    format: ['esm', 'cjs'],
    dts: true,
    sourcemap: true,
    clean: true,
    splitting: false,
    treeshake: true,
    minify: true,
    target: 'es2022',
    external: ['@huggingface/transformers', '@mlc-ai/web-llm', 'onnxruntime-web'],
  },
]);
