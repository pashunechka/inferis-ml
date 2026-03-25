import typescript from '@rollup/plugin-typescript';
import { defineConfig } from 'rollup';

export default defineConfig([
  {
    input: 'src/worker/dedicated.worker.ts',
    output: {
      file: 'dist/worker/dedicated.worker.js',
      format: 'esm',
      inlineDynamicImports: true,
    },
    plugins: [
      typescript({
        tsconfig: './tsconfig.json',
        declaration: false,
        declarationMap: false,
        sourceMap: false,
      }),
    ],
    external: ['@huggingface/transformers', '@mlc-ai/web-llm', 'onnxruntime-web'],
  },
  {
    input: 'src/worker/shared.worker.ts',
    output: {
      file: 'dist/worker/shared.worker.js',
      format: 'esm',
      inlineDynamicImports: true,
    },
    plugins: [
      typescript({
        tsconfig: './tsconfig.json',
        declaration: false,
        declarationMap: false,
        sourceMap: false,
      }),
    ],
    external: ['@huggingface/transformers', '@mlc-ai/web-llm', 'onnxruntime-web'],
  },
]);
