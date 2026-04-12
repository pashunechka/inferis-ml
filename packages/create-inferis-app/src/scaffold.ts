import { cpSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Options } from './prompts.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const ADAPTER_CONFIG: Record<Options['adapter'], {
  package: string;
  version: string;
  factoryImport: string;
  factoryCall: string;
  adapterPath: string;
  model: string;
  extraConfig: string;
  streamCall: string;
  modelBadge: string;
}> = {
  transformers: {
    package: '@huggingface/transformers',
    version: '^3.0.0',
    factoryImport: "import { transformersAdapter } from 'inferis-ml/adapters/transformers';",
    factoryCall: 'transformersAdapter()',
    adapterPath: 'inferis-ml/adapters/transformers',
    model: 'onnx-community/Llama-3.2-1B-Instruct',
    extraConfig: "\n    dtype: 'q4f16',",
    streamCall: 'model.stream(messages, { max_new_tokens: 512 })',
    modelBadge: 'Llama-3.2-1B (WASM)',
  },
  'web-llm': {
    package: '@mlc-ai/web-llm',
    version: '^0.2.0',
    factoryImport: "import { webLlmAdapter } from 'inferis-ml/adapters/web-llm';",
    factoryCall: 'webLlmAdapter()',
    adapterPath: 'inferis-ml/adapters/web-llm',
    model: 'Llama-3.2-1B-Instruct-q4f16_1-MLC',
    extraConfig: '',
    streamCall: 'model.stream({ messages, temperature: 0.7, max_tokens: 512 })',
    modelBadge: 'Llama-3.2-1B (WebGPU)',
  },
};

function templateDir(): string {
  return resolve(__dirname, '..', 'templates', 'vite-vanilla');
}

export function scaffold(targetDir: string, options: Options): void {
  const cfg = ADAPTER_CONFIG[options.adapter];

  cpSync(templateDir(), targetDir, { recursive: true });

  replaceInFile(join(targetDir, 'package.json'), {
    '{{PROJECT_NAME}}': basename(targetDir),
    '{{ADAPTER_PACKAGE}}': cfg.package,
    '{{ADAPTER_VERSION}}': cfg.version,
  });

  replaceInFile(join(targetDir, 'src', 'worker.ts'), {
    '{{ADAPTER_IMPORT}}': cfg.factoryImport,
    '{{ADAPTER_CALL}}': cfg.factoryCall,
  });

  replaceInFile(join(targetDir, 'src', 'main.ts'), {
    '{{ADAPTER_PATH}}': cfg.adapterPath,
    '{{ADAPTER_CALL}}': cfg.factoryCall,
    '{{MODEL_ID}}': cfg.model,
    '{{EXTRA_CONFIG}}': cfg.extraConfig,
    '{{STREAM_CALL}}': cfg.streamCall,
  });

  replaceInFile(join(targetDir, 'index.html'), {
    '{{MODEL_BADGE}}': cfg.modelBadge,
  });
}

function replaceInFile(filePath: string, replacements: Record<string, string>): void {
  let content = readFileSync(filePath, 'utf-8');
  for (const [marker, value] of Object.entries(replacements)) {
    content = content.replaceAll(marker, value);
  }
  writeFileSync(filePath, content);
}
