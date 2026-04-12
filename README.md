# inferis

Worker pool for running AI models in the browser — WebGPU/WASM auto-detection, model lifecycle management, token streaming, and cross-tab deduplication.

[![npm version](https://img.shields.io/npm/v/inferis)](https://npmjs.com/package/inferis)
[![bundle size](https://img.shields.io/bundlephobia/minzip/inferis)](https://bundlephobia.com/package/inferis)
[![coverage](https://img.shields.io/badge/coverage-93%25-green)](https://github.com/pashunechka/inferis-ml)

> **[Live Examples](https://pashunechka.github.io/inferis/)** — run AI models directly in your browser, no server needed.

## What is this

You want to add smart search, speech recognition, or a chatbot to your website. Normally this requires a server — you send a request to the cloud, wait for a response, pay per call.

**inferis** lets you run AI models directly in the user's browser. The model downloads once, then runs on the user's GPU/CPU. No server, no per-request cost, no data leaving the device.

The catch: running a neural network in the browser is technically painful. Run it on the main thread and the page freezes. Move it to a Web Worker and you're writing `postMessage` boilerplate. inferis takes that pain away.

### Three problems it solves

**1. Page freezes during inference**

Without inferis, running a model on the main thread locks the UI. With inferis, work runs in a background worker — the page stays responsive.

**2. 5 open tabs = 5 model copies in RAM**

Without inferis: 5 tabs × 2 GB LLM = 10 GB RAM. Browser crashes.
With `crossTab: true`: all tabs share one worker, one model copy in memory.

**3. WebGPU not available everywhere**

Without inferis: you manually detect WebGPU and swap backends.
With `defaultDevice: 'auto'`: inferis tries WebGPU, silently falls back to WASM if unavailable.

---

## Why

Existing browser AI runtimes (transformers.js, web-llm, onnxruntime-web) give you inference but leave worker management entirely to you:

- Create the Web Worker manually
- Wire up `postMessage` and response correlation
- Implement model lifecycle (load → infer → dispose)
- Avoid loading the same model twice across browser tabs
- Handle WebGPU → WASM fallback
- Evict models when memory budget is exceeded
- Forward streaming tokens to the UI

**inferis** handles all of this. You get a clean async API and focus on building the product.

## Features

- **Runtime-agnostic** — adapters for `@huggingface/transformers`, `@mlc-ai/web-llm`, `onnxruntime-web`, or your own
- **Zero framework dependencies** — works with React, Vue, Svelte, or vanilla JS
- **WebGPU → WASM fallback** — auto-detected, or configured explicitly
- **Streaming** — `ReadableStream` + `for await` for token-by-token LLM output
- **Memory budget** — LRU eviction when models exceed the configured cap
- **Cross-tab dedup** — SharedWorker (tier 1), leader election (tier 2), or per-tab fallback (tier 3)
- **AbortController** — cancel any in-flight inference
- **TypeScript** — full type safety, generic output types

## Install

```bash
npm install inferis

# Install the adapter you need (optional peer deps):
npm install @huggingface/transformers   # for transformersAdapter
npm install @mlc-ai/web-llm             # for webLlmAdapter
npm install onnxruntime-web             # for onnxAdapter
```

## Use Cases

### Semantic search over articles

User types a query — find articles by meaning, not just keywords.

```typescript
import { createPool } from 'inferis-ml';
import { transformersAdapter } from 'inferis-ml/adapters/transformers';

const pool = await createPool({ adapter: transformersAdapter() });

const embedder = await pool.load<number[][]>('feature-extraction', {
  model: 'mixedbread-ai/mxbai-embed-xsmall-v1',
  onProgress: ({ phase, loaded, total }) => {
    const pct = total > 0 ? Math.round(loaded / total * 100) : 0;
    updateProgressBar(pct, phase);
  },
});

const articles = ['How to choose a laptop', 'Borscht recipe', 'History of Rome'];
const embeddings = await embedder.run(articles);
// embeddings: number[][] — one vector per article

const query = await embedder.run(['buy a computer']);
// compare query[0] against embeddings with cosine similarity
```

### Chatbot with streaming output

Answer appears word by word, like ChatGPT.

```typescript
import { createPool } from 'inferis-ml';
import { webLlmAdapter } from 'inferis-ml/adapters/web-llm';

const pool = await createPool({
  adapter: webLlmAdapter(),
  maxWorkers: 1,           // LLMs use one GPU context
  defaultDevice: 'webgpu',
});

const llm = await pool.load<string>('text-generation', {
  model: 'Llama-3.2-3B-Instruct-q4f32_1-MLC',
  onProgress: ({ phase }) => setStatus(phase),
});

const outputDiv = document.getElementById('answer');
const stream = llm.stream({
  messages: [
    { role: 'system', content: 'You are a helpful assistant.' },
    { role: 'user', content: userQuestion },
  ],
});

for await (const token of stream) {
  outputDiv.textContent += token;
}
```

### Speech transcription

```typescript
const transcriber = await pool.load<{ text: string }>('automatic-speech-recognition', {
  model: 'openai/whisper-base',
  estimatedMemoryMB: 80,
});

const audioData = await getMicrophoneAudio(); // Float32Array
const result = await transcriber.run(audioData);
console.log(result.text); // "Hello, how are you?"
```

### Cancel a running request

```typescript
const controller = new AbortController();
stopButton.onclick = () => controller.abort();

try {
  const stream = llm.stream(input, { signal: controller.signal });
  for await (const token of stream) {
    outputDiv.textContent += token;
  }
} catch (e) {
  if (e.name === 'AbortError') outputDiv.textContent += ' [stopped]';
}
```

### Model state changes

```typescript
model.onStateChange((state) => {
  if (state === 'loading')  showSpinner();
  if (state === 'ready')    hideSpinner();
  if (state === 'error')    showError('Failed to load model');
  if (state === 'disposed') disableUI();
});
```

---

## Quick Start

### Embeddings

```typescript
import { createPool } from 'inferis-ml';
import { transformersAdapter } from 'inferis-ml/adapters/transformers';

const pool = await createPool({
  adapter: transformersAdapter(),
});

const model = await pool.load<number[][]>('feature-extraction', {
  model: 'mixedbread-ai/mxbai-embed-xsmall-v1',
  onProgress: (p) => console.log(`${p.phase}: ${(p.loaded / p.total * 100) | 0}%`),
});

const embeddings = await model.run(['Hello world', 'Another sentence']);
// embeddings: number[][]

await model.dispose();
await pool.terminate();
```

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
  model: 'Llama-3.1-8B-Instruct-q4f32_1-MLC',
  onProgress: ({ phase }) => console.log(phase),
});

const stream = llm.stream({
  messages: [
    { role: 'system', content: 'You are a helpful assistant.' },
    { role: 'user', content: 'Explain WebGPU in 3 sentences.' },
  ],
});

const output = document.getElementById('output');
for await (const token of stream) {
  output.textContent += token;
}
```

### Abort

```typescript
const ctrl = new AbortController();

const stream = llm.stream(input, { signal: ctrl.signal });

// Cancel after 5 seconds
setTimeout(() => ctrl.abort(), 5000);

try {
  for await (const token of stream) {
    updateUI(token);
  }
} catch (e) {
  if (e.name === 'AbortError') console.log('Cancelled');
}
```

### Cross-Tab Deduplication

```typescript
// Enable cross-tab model sharing.
// If you open 5 tabs, the model is loaded only once.
const pool = await createPool({
  adapter: transformersAdapter(),
  crossTab: true,   // auto-selects SharedWorker > leader election > per-tab
});
```

### Capability Detection

```typescript
import { detectCapabilities } from 'inferis-ml';

const caps = await detectCapabilities();

if (caps.webgpu.supported) {
  console.log('GPU vendor:', caps.webgpu.adapter?.vendor);
  console.log('Max buffer:', caps.webgpu.limits?.maxBufferSize);
} else {
  console.log('Falling back to WASM');
  console.log('SIMD support:', caps.wasm.simd);
}
```

## Custom Adapter

```typescript
import type { ModelAdapter, ModelAdapterFactory } from 'inferis-ml';

export function myCustomAdapter(): ModelAdapterFactory {
  return {
    name: 'my-adapter',

    async create(): Promise<ModelAdapter> {
      // This runs INSIDE the worker — safe to import heavy libs here
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

## API Reference

### `createPool(config)`

```typescript
const pool = await createPool({
  adapter: transformersAdapter(),   // required

  workerUrl: new URL('inferis-ml/worker', import.meta.url),  // worker bundle URL
  maxWorkers: navigator.hardwareConcurrency - 1,          // default: cores - 1
  maxMemoryMB: 2048,                                       // default: 2048
  defaultDevice: 'auto',                                   // 'webgpu' | 'wasm' | 'auto'
  crossTab: false,                                         // cross-tab dedup
  taskTimeout: 120_000,                                    // per-task timeout in ms
});
```

### `pool.load<TOutput>(task, config)`

Loads a model and returns a `ModelHandle`. If the model is already loaded, returns the existing handle.

```typescript
const model = await pool.load<number[][]>('feature-extraction', {
  model: 'mixedbread-ai/mxbai-embed-xsmall-v1',
  estimatedMemoryMB: 30,          // hint for memory budget (optional)
  onProgress: (p) => { ... },     // download/load progress
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
  signal?: AbortSignal;              // cancel via AbortController
  priority?: 'high' | 'normal' | 'low';  // scheduling priority
}
```

## Bundler Setup

### Vite

```typescript
// vite.config.ts
export default {
  worker: { format: 'es' },
};
```

```typescript
// Usage
const pool = await createPool({
  adapter: transformersAdapter(),
  workerUrl: new URL('inferis-ml/worker', import.meta.url),
});
```

### webpack 5

```typescript
// webpack.config.js
module.exports = {
  experiments: { asyncWebAssembly: true },
};
```

### Inline Worker (no bundler config needed)

```typescript
import { createPool } from 'inferis-ml';
import { inlineWorkerUrl } from 'inferis-ml/worker-inline';

const pool = await createPool({
  adapter: transformersAdapter(),
  workerUrl: inlineWorkerUrl(),  // creates a Blob URL
});
```

## Browser Support

| Feature | Chrome | Firefox | Safari | Edge | iOS Safari | Android Chrome |
|---------|--------|---------|--------|------|------------|----------------|
| Core (Worker + WASM) | 57+ | 52+ | 11+ | 16+ | 11+ | 57+ |
| WebGPU | 113+ | 141+ | 26+ | 113+ | 26+ | 121+ |
| WASM SIMD | 91+ | 89+ | 16.4+ | 91+ | 16.4+ | 91+ |
| SharedWorker (cross-tab tier 1) | 4+ | 29+ | 16+ | 79+ | — | — |
| Leader Election (cross-tab tier 2) | 69+ | 96+ | 15.4+ | 79+ | 15.4+ | 69+ |
| AbortController | 66+ | 57+ | 12.1+ | 16+ | 12.2+ | 66+ |

**Minimum requirement:** Web Workers + WebAssembly (97%+ of browsers worldwide).
All advanced features (WebGPU, SharedWorker, leader election) are progressive enhancements.

## Performance Tips

- **Set `maxWorkers: 1`** for GPU-bound workloads (LLMs) — GPU has one execution context.
- **Set `defaultDevice: 'webgpu'`** explicitly if you know your users have modern hardware.
- **Use `estimatedMemoryMB`** to help the memory budget make accurate eviction decisions.
- **Reuse `ModelHandle`** — loading a model already in state `ready` is a no-op.
- **Enable `crossTab: true`** for apps users open in multiple tabs (chat, document editors).

## Popular Models

Models are downloaded automatically from [Hugging Face Hub](https://huggingface.co/models) on first use and cached in the browser's Cache API. Subsequent page loads use the cache — no re-download, works offline.

### Embeddings / Semantic Search

| Model ID | Size | Notes |
|----------|------|-------|
| `mixedbread-ai/mxbai-embed-xsmall-v1` | 23 MB | Best quality/size ratio for English |
| `Xenova/all-MiniLM-L6-v2` | 23 MB | Popular multilingual embedding model |
| `Xenova/all-mpnet-base-v2` | 86 MB | Higher quality, larger |
| `Xenova/multilingual-e5-small` | 118 MB | 100+ languages |

```typescript
const model = await pool.load<number[][]>('feature-extraction', {
  model: 'mixedbread-ai/mxbai-embed-xsmall-v1',
});
const vectors = await model.run(['Hello world', 'Another sentence']);
```

### Text Generation (LLM)

> Requires `@mlc-ai/web-llm` and `defaultDevice: 'webgpu'`. Models are large — download once, cached permanently.

| Model ID | Size | Notes |
|----------|------|-------|
| `Llama-3.2-1B-Instruct-q4f32_1-MLC` | 0.8 GB | Fastest, decent quality |
| `Llama-3.2-3B-Instruct-q4f32_1-MLC` | 2 GB | Good balance |
| `Phi-3.5-mini-instruct-q4f16_1-MLC` | 2.2 GB | Microsoft, strong reasoning |
| `Llama-3.1-8B-Instruct-q4f32_1-MLC` | 5 GB | Best quality, needs 8+ GB RAM |
| `gemma-2-2b-it-q4f16_1-MLC` | 1.5 GB | Google, fast on mobile GPU |

```typescript
const llm = await pool.load<string>('text-generation', {
  model: 'Llama-3.2-3B-Instruct-q4f32_1-MLC',
});
const stream = llm.stream({ messages: [{ role: 'user', content: 'Hello!' }] });
for await (const token of stream) { outputDiv.textContent += token; }
```

### Speech Recognition

| Model ID | Size | Notes |
|----------|------|-------|
| `openai/whisper-tiny` | 39 MB | Fastest, lower accuracy |
| `openai/whisper-base` | 74 MB | Good balance |
| `openai/whisper-small` | 244 MB | Better accuracy |
| `openai/whisper-medium` | 769 MB | Near server-level accuracy |

```typescript
const model = await pool.load<{ text: string }>('automatic-speech-recognition', {
  model: 'openai/whisper-base',
});
const result = await model.run(float32AudioArray);
console.log(result.text);
```

### Text Classification / Sentiment

| Model ID | Size | Notes |
|----------|------|-------|
| `Xenova/distilbert-base-uncased-finetuned-sst-2-english` | 67 MB | Positive/negative sentiment |
| `Xenova/bert-base-multilingual-uncased-sentiment` | 168 MB | Multilingual, 1–5 stars |
| `Xenova/toxic-bert` | 438 MB | Toxicity detection |

```typescript
const model = await pool.load<{ label: string; score: number }[]>('text-classification', {
  model: 'Xenova/distilbert-base-uncased-finetuned-sst-2-english',
});
const result = await model.run('I love this product!');
// [{ label: 'POSITIVE', score: 0.999 }]
```

### Translation

| Model ID | Size | Notes |
|----------|------|-------|
| `Xenova/opus-mt-en-ru` | 74 MB | English → Russian |
| `Xenova/opus-mt-ru-en` | 74 MB | Russian → English |
| `Xenova/m2m100_418M` | 418 MB | 100 languages ↔ 100 languages |
| `Xenova/nllb-200-distilled-600M` | 600 MB | Meta, 200 languages |

```typescript
const model = await pool.load<{ translation_text: string }[]>('translation', {
  model: 'Xenova/opus-mt-en-ru',
});
const result = await model.run('Hello, world!');
// [{ translation_text: 'Привет, мир!' }]
```

### Image Classification

| Model ID | Size | Notes |
|----------|------|-------|
| `Xenova/vit-base-patch16-224` | 343 MB | General image classification |
| `Xenova/mobilevit-small` | 22 MB | Lightweight, mobile-friendly |
| `Xenova/efficientnet-lite4` | 13 MB | Fastest, 1000 ImageNet classes |

```typescript
const model = await pool.load<{ label: string; score: number }[]>('image-classification', {
  model: 'Xenova/efficientnet-lite4',
});
const result = await model.run('https://example.com/cat.jpg');
// [{ label: 'tabby cat', score: 0.92 }]
```

### How downloads work

```
First visit:   download from source → save to Cache API → run
               (5–60s depending on model size and connection)

Next visits:   load from Cache API → run
               (1–3s initialization only, no network needed)

Offline:       load from Cache API → run
               (works without internet after first load)
```

### Where models come from

Models are **not** locked to Hugging Face. Each adapter has its own sources:

**transformers.js** — HF Hub ID or any direct URL:

```typescript
// From Hugging Face Hub (default)
await pool.load('feature-extraction', {
  model: 'mixedbread-ai/mxbai-embed-xsmall-v1',
});

// From your own CDN or server
await pool.load('feature-extraction', {
  model: 'https://your-cdn.com/models/mxbai-embed-xsmall-v1',
});
```

The model folder must contain the same file structure as HF Hub: `onnx/model.onnx`, `tokenizer.json`, `config.json`. You can download a model from HF Hub once and re-host it anywhere.

**web-llm** — from the MLC model registry by default. To use your own hosted model, add it to the registry before creating the pool:

```typescript
import { CreateMLCEngine, prebuiltAppConfig } from '@mlc-ai/web-llm';

// Register a custom model
const customConfig = {
  ...prebuiltAppConfig,
  model_list: [
    ...prebuiltAppConfig.model_list,
    {
      model: 'https://your-cdn.com/my-llm/',  // folder with model shards
      model_id: 'my-custom-llm',
      model_lib: 'https://your-cdn.com/my-llm/model.wasm',
    },
  ],
};

// Pass config through the adapter
const pool = await createPool({ adapter: webLlmAdapter({ appConfig: customConfig }) });
await pool.load('text-generation', { model: 'my-custom-llm' });
```

**onnxruntime-web** — direct URL to a `.onnx` file, no registry:

```typescript
await pool.load('custom', {
  model: 'https://your-cdn.com/model.onnx',
});
```

**Custom adapter** — full control, load from anywhere (fetch, IndexedDB, bundled asset):

```typescript
async load(task, config, device, onProgress) {
  // fetch from any source
  const response = await fetch(config.model as string);
  const total = Number(response.headers.get('content-length') ?? 0);
  let loaded = 0;

  const reader = response.body!.getReader();
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.byteLength;
    onProgress({ loaded, phase: 'downloading', total });
  }

  // build model from raw bytes
  const buffer = mergeChunks(chunks);
  const instance = await MyRuntime.loadFromBuffer(buffer);
  return { instance, memoryMB: 50 };
}
```

---

## When to use

| Scenario | Suitable? |
|----------|-----------|
| Semantic search over content | ✓ |
| Chatbot / text generation | ✓ |
| Speech transcription | ✓ |
| Image classification | ✓ |
| Sentiment analysis | ✓ |
| Translation | ✓ |
| Private data processing (data never leaves the device) | ✓ |
| Offline mode (works after first load, no internet) | ✓ |
| High-volume batch processing on a server | ✗ use server-side inference |
| Real-time video/audio streaming analysis | ✗ latency too high for WASM |

### inferis is a good fit when

- You want to avoid per-request API costs
- Your users' data is sensitive and must not leave the device
- You need the app to work offline after first load
- Your users have modern hardware (GPU acceleration is a bonus, not a requirement)
- You are building a single-page app where the model stays loaded across user interactions

### inferis is not a good fit when

- You need to process large datasets server-side
- Your model is too large to download in a browser (>4 GB)
- You need to support very old browsers (IE, Safari < 11)
- Inference latency must be under 100ms on low-end mobile devices

## License

MIT
