# inferis-react

React hooks and providers for [inferis-ml](https://www.npmjs.com/package/inferis-ml) -- run AI models directly in the browser with WebGPU/WASM.

## Install

```bash
npm install inferis-react inferis-ml
```

## Quick Start

```tsx
import { InferisProvider, useModel, useStream } from 'inferis-react';
import { webLlmAdapter } from 'inferis-ml/adapters/web-llm';

function App() {
  return (
    <InferisProvider adapter={webLlmAdapter()}>
      <Demo />
    </InferisProvider>
  );
}

function Demo() {
  const { model, state, progress } = useModel('text-generation', {
    model: 'Llama-3.2-1B-Instruct-q4f16_1-MLC',
    autoLoad: true,
  });

  const { text, isStreaming, start, stop } = useStream<string>(model);

  if (state === 'loading') {
    const pct = progress ? Math.round((progress.loaded / (progress.total || 1)) * 100) : 0;
    return <p>Loading model... {pct}%</p>;
  }

  if (state === 'error') return <p>Failed to load model</p>;

  return (
    <div>
      <button onClick={() => start({ prompt: 'Explain quantum computing in 3 sentences' })}>
        Generate
      </button>
      {isStreaming && <button onClick={stop}>Stop</button>}
      <p>{text}</p>
    </div>
  );
}
```

## API Reference

### `<InferisProvider>`

Root provider. Creates a `WorkerPool` on mount, terminates on unmount.

```tsx
<InferisProvider
  adapter={webLlmAdapter()}
  poolConfig={{ maxMemoryMB: 4096, maxWorkers: 2 }}
>
  <App />
</InferisProvider>
```

| Prop | Type | Description |
|------|------|-------------|
| `adapter` | `ModelAdapterFactory` | Required. Adapter from `inferis-ml/adapters/*` |
| `poolConfig` | `Partial<PoolConfig>` | Optional pool settings (memory limit, workers, device, etc.) |

---

### `useInferis()`

Raw access to the worker pool.

```ts
const { pool, isReady } = useInferis();
```

| Field | Type | Description |
|-------|------|-------------|
| `pool` | `WorkerPool \| null` | Pool instance, `null` while initializing |
| `isReady` | `boolean` | `true` when pool is created |

---

### `useCapabilities()`

Device capability detection (WebGPU, WASM SIMD, SharedWorker, etc.).

```ts
const { capabilities, isLoading } = useCapabilities();

if (capabilities?.webgpu.supported) {
  console.log('GPU:', capabilities.webgpu.adapter?.vendor);
}
```

| Field | Type | Description |
|-------|------|-------------|
| `capabilities` | `CapabilityReport \| null` | Detection result |
| `isLoading` | `boolean` | `true` while detecting |

---

### `useModel(task, config)`

Load and manage a model lifecycle. Handles React StrictMode correctly -- the cleanup function aborts in-flight loads and disposes the model, preventing double-loading.

```ts
const { model, state, progress, error, load, dispose } = useModel('text-generation', {
  model: 'Llama-3.2-1B-Instruct-q4f16_1-MLC',
  autoLoad: true,
});
```

| Config | Type | Default | Description |
|--------|------|---------|-------------|
| `model` | `string` | -- | Model ID (HuggingFace ID, URL, etc.) |
| `autoLoad` | `boolean` | `false` | Load model immediately on mount |
| `estimatedMemoryMB` | `number` | -- | Memory hint for budget pre-eviction |

| Return | Type | Description |
|--------|------|-------------|
| `model` | `ModelHandle \| null` | Model handle for inference |
| `state` | `ModelState \| 'pending'` | Current lifecycle state |
| `progress` | `LoadProgressEvent \| null` | Download/load progress (`phase`, `loaded`, `total`) |
| `error` | `Error \| null` | Load error |
| `load()` | `() => Promise<void>` | Manually trigger loading |
| `dispose()` | `() => Promise<void>` | Unload model and free memory |

Auto-disposes on unmount. Progress example:

```tsx
function LoadingBar() {
  const { state, progress } = useModel('text-generation', {
    model: 'Llama-3.2-1B-Instruct-q4f16_1-MLC',
    autoLoad: true,
  });

  if (state !== 'loading' || !progress) return null;

  const pct = Math.round((progress.loaded / (progress.total || 1)) * 100);
  return (
    <div>
      <div style={{ width: `${pct}%`, height: 4, background: '#3b82f6' }} />
      <p>{progress.phase} -- {pct}%</p>
    </div>
  );
}
```

---

### `useInference<T>(model)`

Single (non-streaming) inference request.

```ts
const { result, error, isLoading, run, reset } = useInference<ClassificationResult>(model);

const output = await run({ text: 'This movie is great!' });
```

| Return | Type | Description |
|--------|------|-------------|
| `result` | `T \| null` | Last inference result |
| `error` | `Error \| null` | Last error |
| `isLoading` | `boolean` | Request in flight |
| `run(input, options?)` | `(input, opts?) => Promise<T>` | Execute inference |
| `reset()` | `() => void` | Clear result and error |

Supports `AbortSignal` via options:

```ts
const controller = new AbortController();
run(input, { signal: controller.signal });
controller.abort();
```

---

### `useStream<T>(model)`

Streaming inference with chunk accumulation.

```ts
const { chunks, text, isStreaming, start, stop, reset } = useStream<string>(model);

start({ prompt: 'Explain quantum computing' });
```

| Return | Type | Description |
|--------|------|-------------|
| `chunks` | `T[]` | All received chunks |
| `text` | `string` | Accumulated text (for string chunks) |
| `isStreaming` | `boolean` | Stream active |
| `start(input, options?)` | `(input, opts?) => void` | Start streaming |
| `stop()` | `() => void` | Abort stream |
| `reset()` | `() => void` | Clear chunks/text, stop if active |

---

### `useMemoryBudget()`

Monitor memory usage across loaded models.

```ts
const { totalMB, allocatedMB, availableMB } = useMemoryBudget();

return <p>Memory: {allocatedMB}/{totalMB} MB used</p>;
```

---

## Adapters

`inferis-ml` ships three adapters. Pass any of them to `<InferisProvider>`:

```ts
import { webLlmAdapter } from 'inferis-ml/adapters/web-llm';         // LLM chat (Llama, Mistral, etc.)
import { transformersAdapter } from 'inferis-ml/adapters/transformers'; // HuggingFace transformers.js
import { onnxAdapter } from 'inferis-ml/adapters/onnx';               // ONNX Runtime Web
```

## Examples

### Image Classification

```tsx
function ImageClassifier() {
  const { model } = useModel('image-classification', {
    model: 'google/vit-base-patch16-224',
    autoLoad: true,
  });
  const { result, isLoading, run } = useInference<{ label: string; score: number }[]>(model);

  return (
    <div>
      <input type="file" accept="image/*" onChange={async (e) => {
        const file = e.target.files?.[0];
        if (file) await run(file);
      }} />
      {isLoading && <p>Classifying...</p>}
      {result?.map(r => <p key={r.label}>{r.label}: {(r.score * 100).toFixed(1)}%</p>)}
    </div>
  );
}
```

### Capability Gate

```tsx
function CapabilityGate({ children }: { children: React.ReactNode }) {
  const { capabilities, isLoading } = useCapabilities();

  if (isLoading) return <p>Detecting device capabilities...</p>;
  if (!capabilities?.webgpu.supported && !capabilities?.wasm.supported) {
    return <p>Your browser does not support WebGPU or WASM.</p>;
  }
  return <>{children}</>;
}
```

### Memory Monitor

```tsx
function MemoryBar() {
  const { totalMB, allocatedMB } = useMemoryBudget();
  const pct = totalMB ? Math.round((allocatedMB / totalMB) * 100) : 0;

  return (
    <div>
      <div style={{ width: `${pct}%`, height: 4, background: pct > 80 ? '#ef4444' : '#22c55e' }} />
      <p>{allocatedMB} / {totalMB} MB</p>
    </div>
  );
}
```

## Next.js App Router

The package ships with `"use client"` directive in the bundle entry point. All hooks and providers are automatically marked as client-only -- no extra configuration needed.

```tsx
// app/ai/page.tsx (Server Component by default)
import { AiChat } from './ai-chat';

export default function Page() {
  return <AiChat />;
}
```

```tsx
// app/ai/ai-chat.tsx
'use client';

import { InferisProvider, useModel, useStream } from 'inferis-react';
import { webLlmAdapter } from 'inferis-ml/adapters/web-llm';

export function AiChat() {
  return (
    <InferisProvider adapter={webLlmAdapter()}>
      <Chat />
    </InferisProvider>
  );
}

function Chat() {
  const { model, state, progress } = useModel('text-generation', {
    model: 'Llama-3.2-1B-Instruct-q4f16_1-MLC',
    autoLoad: true,
  });
  const { text, isStreaming, start, stop } = useStream<string>(model);

  if (state === 'loading') {
    return <p>Loading... {Math.round((progress?.loaded ?? 0) / (progress?.total || 1) * 100)}%</p>;
  }

  return (
    <div>
      <button onClick={() => start({ prompt: 'Hello!' })}>Generate</button>
      {isStreaming && <button onClick={stop}>Stop</button>}
      <p>{text}</p>
    </div>
  );
}
```

> ML inference runs entirely in the browser via Web Workers -- there is no server-side model loading. `<InferisProvider>` and all hooks must be used in Client Components only.

## Requirements

- React 18+
- [inferis-ml](https://www.npmjs.com/package/inferis-ml) 1.0+
- Browser with WebGPU or WASM support

## License

MIT
