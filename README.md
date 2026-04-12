# inferis-ml

[![npm version](https://img.shields.io/npm/v/inferis-ml)](https://npmjs.com/package/inferis-ml)
[![bundle size](https://img.shields.io/badge/minzip-6.7%20kB-blue)](https://npmjs.com/package/inferis-ml)
[![coverage](https://img.shields.io/badge/coverage-93%25-green)](https://github.com/pashunechka/inferis-ml)
[![npm downloads](https://img.shields.io/npm/dw/inferis-ml)](https://npmjs.com/package/inferis-ml)
[![license](https://img.shields.io/npm/l/inferis-ml)](https://github.com/pashunechka/inferis-ml/blob/main/LICENSE)
[![Known Vulnerabilities](https://snyk.io/test/github/pashunechka/inferis-ml/badge.svg)](https://snyk.io/test/github/pashunechka/inferis-ml)
[![GitHub stars](https://img.shields.io/github/stars/pashunechka/inferis-ml?style=social)](https://github.com/pashunechka/inferis-ml)

Run AI models in the browser. No server, no per-request cost, no data leaving the device.

> **[Live Demo](https://pashunechka.github.io/inferis-ml/)** — try it in your browser.

```typescript
import { createPool } from 'inferis-ml';
import { transformersAdapter } from 'inferis-ml/adapters/transformers';

const pool = await createPool({ adapter: transformersAdapter() });
const model = await pool.load<number[][]>('feature-extraction', {
  model: 'mixedbread-ai/mxbai-embed-xsmall-v1',
});

const embeddings = await model.run(['Hello world', 'Another sentence']);
```

## Why

Existing browser runtimes (transformers.js, web-llm, onnxruntime-web) give you inference but leave everything else to you — worker management, `postMessage` boilerplate, model lifecycle, memory budgets, cross-tab dedup, WebGPU fallback, streaming.

inferis-ml handles all of it. You get a clean async API and focus on the product.

| Problem | Without inferis-ml | With inferis-ml |
|---------|-------------------|-----------------|
| UI freezes during inference | Main thread blocked | Runs in Web Workers |
| 5 tabs = 5 model copies | 10 GB RAM, browser crashes | `crossTab: true` — one shared copy |
| WebGPU not everywhere | Manual detection + swap | `defaultDevice: 'auto'` |

## Install

```bash
npm install inferis-ml

# Pick your adapter (peer deps):
npm install @huggingface/transformers   # transformersAdapter
npm install @mlc-ai/web-llm             # webLlmAdapter
npm install onnxruntime-web             # onnxAdapter
```

## Quick Start

### LLM Streaming

```typescript
import { createPool } from 'inferis-ml';
import { webLlmAdapter } from 'inferis-ml/adapters/web-llm';

const pool = await createPool({
  adapter: webLlmAdapter(),
  defaultDevice: 'webgpu',
  maxWorkers: 1,
});

const llm = await pool.load<string>('text-generation', {
  model: 'Llama-3.2-3B-Instruct-q4f32_1-MLC',
  onProgress: ({ phase }) => console.log(phase),
});

const stream = llm.stream({
  messages: [
    { role: 'system', content: 'You are a helpful assistant.' },
    { role: 'user', content: 'Explain WebGPU in 3 sentences.' },
  ],
});

for await (const token of stream) {
  output.textContent += token;
}
```

### Speech Transcription

```typescript
const transcriber = await pool.load<{ text: string }>('automatic-speech-recognition', {
  model: 'openai/whisper-base',
  estimatedMemoryMB: 80,
});

const result = await transcriber.run(audioData);
console.log(result.text);
```

### Abort Inference

```typescript
const ctrl = new AbortController();
stopButton.onclick = () => ctrl.abort();

try {
  for await (const token of llm.stream(input, { signal: ctrl.signal })) {
    output.textContent += token;
  }
} catch (e) {
  if (e.name === 'AbortError') output.textContent += ' [stopped]';
}
```

### Cross-Tab Deduplication

```typescript
const pool = await createPool({
  adapter: transformersAdapter(),
  crossTab: true, // SharedWorker > leader election > per-tab fallback
});
```

### Model State Changes

```typescript
model.onStateChange((state) => {
  if (state === 'loading')  showSpinner();
  if (state === 'ready')    hideSpinner();
  if (state === 'error')    showError('Failed to load model');
  if (state === 'disposed') disableUI();
});
```

## Features

- **Runtime-agnostic** — adapters for `@huggingface/transformers`, `@mlc-ai/web-llm`, `onnxruntime-web`, or your own
- **Zero framework deps** — works with React, Vue, Svelte, or vanilla JS
- **WebGPU -> WASM fallback** — auto-detected or configured explicitly
- **Streaming** — `ReadableStream` + `for await` for token-by-token output
- **Memory budget** — LRU eviction when models exceed the configured cap
- **Cross-tab dedup** — SharedWorker (tier 1), leader election (tier 2), per-tab (tier 3)
- **AbortController** — cancel any in-flight inference
- **TypeScript** — full type safety, generic output types

## API Reference

### `createPool(config)`

```typescript
const pool = await createPool({
  adapter: transformersAdapter(),   // required
  workerUrl: new URL('inferis-ml/worker', import.meta.url),
  maxWorkers: navigator.hardwareConcurrency - 1,
  maxMemoryMB: 2048,
  defaultDevice: 'auto',           // 'webgpu' | 'wasm' | 'auto'
  crossTab: false,
  taskTimeout: 120_000,
});
```

### `pool.load<TOutput>(task, config)`

Loads a model and returns a `ModelHandle`. If already loaded, returns the existing handle.

```typescript
const model = await pool.load<number[][]>('feature-extraction', {
  model: 'mixedbread-ai/mxbai-embed-xsmall-v1',
  estimatedMemoryMB: 30,
  onProgress: (p) => { ... },
});
```

### `ModelHandle<TOutput>`

| Method | Description |
|--------|-------------|
| `run(input, options?)` | Non-streaming inference. Returns `Promise<TOutput>`. |
| `stream(input, options?)` | Streaming inference. Returns `ReadableStream<TOutput>`. |
| `dispose()` | Unload model and free memory. |
| `onStateChange(cb)` | Subscribe to state changes. Returns unsubscribe function. |
| `id` | Unique model ID (`task:model`). |
| `state` | Current state: `idle \| loading \| ready \| inferring \| unloading \| error \| disposed`. |
| `memoryMB` | Approximate memory usage. |
| `device` | Resolved device: `webgpu` or `wasm`. |

### `InferenceOptions`

```typescript
interface InferenceOptions {
  signal?: AbortSignal;
  priority?: 'high' | 'normal' | 'low';
}
```

### `detectCapabilities()`

```typescript
import { detectCapabilities } from 'inferis-ml';

const caps = await detectCapabilities();
if (caps.webgpu.supported) {
  console.log('GPU vendor:', caps.webgpu.adapter?.vendor);
} else {
  console.log('WASM SIMD:', caps.wasm.simd);
}
```

## Custom Adapter

```typescript
import type { ModelAdapter, ModelAdapterFactory } from 'inferis-ml';

export function myCustomAdapter(): ModelAdapterFactory {
  return {
    name: 'my-adapter',

    async create(): Promise<ModelAdapter> {
      const { MyRuntime } = await import('my-runtime');

      return {
        name: 'my-adapter',

        estimateMemoryMB(_task, config) {
          return (config.estimatedMemoryMB as number) ?? 50;
        },

        async load(task, config, device, onProgress) {
          onProgress({ phase: 'loading', loaded: 0, total: 1 });
          const instance = await MyRuntime.load(config.model as string, { device });
          onProgress({ phase: 'done', loaded: 1, total: 1 });
          return { instance, memoryMB: 50 };
        },

        async run(model, input) {
          return (model.instance as MyRuntime).infer(input);
        },

        async stream(model, input, onChunk) {
          for await (const chunk of (model.instance as MyRuntime).stream(input)) {
            onChunk(chunk);
          }
        },

        async unload(model) {
          await (model.instance as MyRuntime).dispose();
        },
      };
    },
  };
}
```

## Bundler & Framework Setup

inferis-ml is browser-only. In SSR frameworks, ensure initialization runs only on the client.

### Vite

```typescript
// vite.config.ts
export default {
  worker: { format: 'es' },
};
```

### webpack 5

```typescript
// webpack.config.js
module.exports = {
  experiments: { asyncWebAssembly: true },
};
```

### Next.js

```tsx
'use client';

import { useEffect, useState } from 'react';
import type { WorkerPoolInterface } from 'inferis-ml';

export default function AI() {
  const [pool, setPool] = useState<WorkerPoolInterface | null>(null);

  useEffect(() => {
    import('inferis-ml').then(({ createPool }) =>
      createPool({ adapter: { type: 'transformers' } })
    ).then(setPool);
  }, []);

  if (!pool) return <p>Loading...</p>;
  // use pool
}
```

### Nuxt

```vue
<template>
  <ClientOnly>
    <InferenceComponent />
  </ClientOnly>
</template>
```

```ts
// composables/useInferis.ts
export async function useInferis() {
  const { createPool } = await import('inferis-ml');
  return createPool({ adapter: { type: 'transformers' } });
}
```

### SvelteKit

```ts
import { browser } from '$app/environment';

let pool;
if (browser) {
  const { createPool } = await import('inferis-ml');
  pool = await createPool({ adapter: { type: 'transformers' } });
}
```

## Popular Models

Models download from [Hugging Face Hub](https://huggingface.co/models) on first use and are cached in the browser's Cache API. Subsequent loads are instant and work offline.

### Embeddings / Semantic Search

| Model | Size | Notes |
|-------|------|-------|
| `mixedbread-ai/mxbai-embed-xsmall-v1` | 23 MB | Best quality/size for English |
| `Xenova/all-MiniLM-L6-v2` | 23 MB | Popular multilingual |
| `Xenova/multilingual-e5-small` | 118 MB | 100+ languages |

### Text Generation (LLM)

> Requires `@mlc-ai/web-llm` + `defaultDevice: 'webgpu'`.

| Model | Size | Notes |
|-------|------|-------|
| `Llama-3.2-1B-Instruct-q4f32_1-MLC` | 0.8 GB | Fastest |
| `Llama-3.2-3B-Instruct-q4f32_1-MLC` | 2 GB | Good balance |
| `Phi-3.5-mini-instruct-q4f16_1-MLC` | 2.2 GB | Strong reasoning |
| `gemma-2-2b-it-q4f16_1-MLC` | 1.5 GB | Fast on mobile GPU |

### Speech Recognition

| Model | Size | Notes |
|-------|------|-------|
| `openai/whisper-tiny` | 39 MB | Fastest |
| `openai/whisper-base` | 74 MB | Good balance |
| `openai/whisper-small` | 244 MB | Better accuracy |

### Text Classification

| Model | Size | Notes |
|-------|------|-------|
| `Xenova/distilbert-base-uncased-finetuned-sst-2-english` | 67 MB | Sentiment |
| `Xenova/toxic-bert` | 438 MB | Toxicity detection |

### Translation

| Model | Size | Notes |
|-------|------|-------|
| `Xenova/opus-mt-en-ru` | 74 MB | EN -> RU |
| `Xenova/opus-mt-ru-en` | 74 MB | RU -> EN |
| `Xenova/nllb-200-distilled-600M` | 600 MB | 200 languages |

### Image Classification

| Model | Size | Notes |
|-------|------|-------|
| `Xenova/efficientnet-lite4` | 13 MB | Fastest, 1000 classes |
| `Xenova/mobilevit-small` | 22 MB | Mobile-friendly |

### Model Sources

Models are **not** locked to Hugging Face. Each adapter has its own sources:

- **transformers.js** — HF Hub ID or any direct URL
- **web-llm** — MLC registry, or register custom models
- **onnxruntime-web** — direct URL to `.onnx` file
- **Custom adapter** — load from anywhere (fetch, IndexedDB, bundled)

### Caching

```
First visit:  download -> Cache API -> run  (5-60s)
Next visits:  Cache API -> run              (1-3s, no network)
Offline:      Cache API -> run              (works without internet)
```

## Browser Support

| Feature | Chrome | Firefox | Safari | Edge |
|---------|--------|---------|--------|------|
| Core (Worker + WASM) | 57+ | 52+ | 11+ | 16+ |
| WebGPU | 113+ | 141+ | 26+ | 113+ |
| WASM SIMD | 91+ | 89+ | 16.4+ | 91+ |
| SharedWorker | 4+ | 29+ | 16+ | 79+ |
| Leader Election | 69+ | 96+ | 15.4+ | 79+ |

**Minimum:** Web Workers + WebAssembly (97%+ of browsers). All advanced features are progressive enhancements.

## Performance Tips

- **`maxWorkers: 1`** for GPU-bound workloads (LLMs)
- **`defaultDevice: 'webgpu'`** when targeting modern hardware
- **`estimatedMemoryMB`** for accurate LRU eviction
- **`crossTab: true`** for multi-tab apps (chat, editors)
- Reuse `ModelHandle` — re-loading a `ready` model is a no-op

## When To Use

| Use case | Fit? |
|----------|------|
| Semantic search, chatbot, speech, classification, translation | Yes |
| Private data (never leaves device) | Yes |
| Offline after first load | Yes |
| Server-side batch processing | No |
| Models > 4 GB | No |

## License

MIT
