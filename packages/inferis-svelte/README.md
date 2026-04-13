# inferis-svelte

[![npm version](https://img.shields.io/npm/v/inferis-svelte.svg)](https://www.npmjs.com/package/inferis-svelte)

Svelte stores and context for [inferis-ml](https://www.npmjs.com/package/inferis-ml) -- run AI models directly in the browser with WebGPU/WASM.

## Install

```bash
npm install inferis-svelte inferis-ml
```

## Quick Start

```svelte
<!-- App.svelte (parent) -->
<script>
import { createInferis } from 'inferis-svelte';
import { webLlmAdapter } from 'inferis-ml/adapters/web-llm';

createInferis({ adapter: webLlmAdapter() });
</script>

<slot />
```

```svelte
<!-- Chat.svelte (child) -->
<script>
import { useModel, useStream } from 'inferis-svelte';

const { model, state, progress } = useModel('text-generation', {
  model: 'Llama-3.2-1B-Instruct-q4f16_1-MLC',
  autoLoad: true,
});

const { text, isStreaming, start, stop } = useStream(model);

function generate() {
  start({ prompt: 'Explain quantum computing in 3 sentences' });
}
</script>

{#if $state === 'loading'}
  <p>Loading model... {$progress ? Math.round(($progress.loaded / ($progress.total || 1)) * 100) : 0}%</p>
{:else if $state === 'error'}
  <p>Failed to load model</p>
{:else}
  <button on:click={generate}>Generate</button>
  {#if $isStreaming}
    <button on:click={stop}>Stop</button>
  {/if}
  <p>{$text}</p>
{/if}
```

## Setup

Call `createInferis()` in a parent component's `<script>` block. All child components can then use any store function.

```svelte
<script>
import { createInferis } from 'inferis-svelte';
import { webLlmAdapter } from 'inferis-ml/adapters/web-llm';

createInferis({
  adapter: webLlmAdapter(),
  poolConfig: { maxMemoryMB: 4096, maxWorkers: 2 },
});
</script>
```

The pool is automatically terminated when the component is destroyed.

---

## API Reference

### `createInferis(options)`

Initialize the inferis context. Must be called during component initialization (top-level `<script>`). Sets up the worker pool, detects capabilities, and provides context to descendants.

| Option | Type | Description |
|--------|------|-------------|
| `adapter` | `ModelAdapterFactory` | Required. Adapter from `inferis-ml/adapters/*` |
| `poolConfig` | `Partial<PoolConfig>` | Optional pool settings (memory limit, workers, device, etc.) |

### `getInferis()`

Raw access to the inferis context. Must be called within a descendant of a component that called `createInferis()`.

Returns `InferisContext` with stores: `pool`, `capabilities`, `isReady`, `error`.

---

### `useInferis()`

Alias for `getInferis()`. Returns the full context.

```ts
const { pool, isReady } = useInferis();
```

| Field | Type | Description |
|-------|------|-------------|
| `pool` | `Writable<WorkerPool \| null>` | Pool instance, `null` while initializing |
| `isReady` | `Readable<boolean>` | `true` when pool is created |

---

### `useCapabilities()`

Device capability detection (WebGPU, WASM SIMD, SharedWorker, etc.).

```svelte
<script>
import { useCapabilities } from 'inferis-svelte';

const { capabilities, isLoading } = useCapabilities();
</script>

{#if $isLoading}
  <p>Detecting...</p>
{:else if $capabilities?.webgpu.supported}
  <p>GPU: {$capabilities.webgpu.adapter?.vendor}</p>
{/if}
```

| Field | Type | Description |
|-------|------|-------------|
| `capabilities` | `Writable<CapabilityReport \| null>` | Detection result |
| `isLoading` | `Readable<boolean>` | `true` while detecting |

---

### `useModel(task, config)`

Load and manage a model lifecycle. Auto-disposes on component destruction.

```ts
const { model, state, progress, error, load, dispose } = useModel('text-generation', {
  model: 'Llama-3.2-1B-Instruct-q4f16_1-MLC',
  autoLoad: true,
});
```

| Config | Type | Default | Description |
|--------|------|---------|-------------|
| `model` | `string` | -- | Model ID (HuggingFace ID, URL, etc.) |
| `autoLoad` | `boolean` | `false` | Load model when pool is ready |
| `estimatedMemoryMB` | `number` | -- | Memory hint for budget pre-eviction |

| Return | Type | Description |
|--------|------|-------------|
| `model` | `Writable<ModelHandle \| null>` | Model handle for inference |
| `state` | `Writable<ModelState \| 'pending'>` | Current lifecycle state |
| `progress` | `Writable<LoadProgressEvent \| null>` | Download/load progress |
| `error` | `Writable<Error \| null>` | Load error |
| `load()` | `() => Promise<void>` | Manually trigger loading |
| `dispose()` | `() => Promise<void>` | Unload model and free memory |

---

### `useInference<T>(model)`

Single (non-streaming) inference request.

```ts
const { result, error, isLoading, run, reset } = useInference(model);

const output = await run({ text: 'This movie is great!' });
```

| Return | Type | Description |
|--------|------|-------------|
| `result` | `Writable<T \| null>` | Last inference result |
| `error` | `Writable<Error \| null>` | Last error |
| `isLoading` | `Writable<boolean>` | Request in flight |
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
const { chunks, text, isStreaming, start, stop, reset } = useStream(model);

start({ prompt: 'Explain quantum computing' });
```

| Return | Type | Description |
|--------|------|-------------|
| `chunks` | `Writable<T[]>` | All received chunks |
| `text` | `Writable<string>` | Accumulated text (for string chunks) |
| `isStreaming` | `Writable<boolean>` | Stream active |
| `error` | `Writable<Error \| null>` | Stream error |
| `start(input, options?)` | `(input, opts?) => void` | Start streaming |
| `stop()` | `() => void` | Abort stream |
| `reset()` | `() => void` | Clear chunks/text, stop if active |

---

### `useMemoryBudget(intervalMs?)`

Monitor memory usage across loaded models. Polls at the given interval (default 1000ms).

```ts
const { totalMB, allocatedMB, availableMB } = useMemoryBudget();
```

---

## Adapters

`inferis-ml` ships three adapters. Pass any of them to `createInferis`:

```ts
import { webLlmAdapter } from 'inferis-ml/adapters/web-llm';
import { transformersAdapter } from 'inferis-ml/adapters/transformers';
import { onnxAdapter } from 'inferis-ml/adapters/onnx';
```

## Examples

### Image Classification

```svelte
<script>
import { useModel, useInference } from 'inferis-svelte';

const { model } = useModel('image-classification', {
  model: 'google/vit-base-patch16-224',
  autoLoad: true,
});

const { result, isLoading, run } = useInference(model);

async function classify(event) {
  const file = event.target?.files?.[0];
  if (file) await run(file);
}
</script>

<input type="file" accept="image/*" on:change={classify} />
{#if $isLoading}
  <p>Classifying...</p>
{/if}
{#if $result}
  {#each $result as r}
    <p>{r.label}: {(r.score * 100).toFixed(1)}%</p>
  {/each}
{/if}
```

### Capability Gate

```svelte
<script>
import { useCapabilities } from 'inferis-svelte';

const { capabilities, isLoading } = useCapabilities();
</script>

{#if $isLoading}
  <p>Detecting device capabilities...</p>
{:else if !$capabilities?.webgpu.supported && !$capabilities?.wasm.supported}
  <p>Your browser does not support WebGPU or WASM.</p>
{:else}
  <slot />
{/if}
```

### Memory Monitor

```svelte
<script>
import { useMemoryBudget } from 'inferis-svelte';

const { totalMB, allocatedMB } = useMemoryBudget();
$: pct = $totalMB ? Math.round(($allocatedMB / $totalMB) * 100) : 0;
</script>

<div>
  <div style="width: {pct}%; height: 4px; background: {pct > 80 ? '#ef4444' : '#22c55e'}" />
  <p>{$allocatedMB} / {$totalMB} MB</p>
</div>
```

## SvelteKit

ML inference runs in the browser via Web Workers -- there is no server-side model loading. The pool creation is already SSR-safe (`typeof window` guard), but composables should only be used in browser-rendered components.

```svelte
<!-- +page.svelte -->
<script>
import { browser } from '$app/environment';
import { createInferis } from 'inferis-svelte';
import { webLlmAdapter } from 'inferis-ml/adapters/web-llm';

if (browser) {
  createInferis({ adapter: webLlmAdapter() });
}
</script>
```

Or wrap with `{#if browser}` to conditionally render child components that use inferis stores.

## Requirements

- Svelte 4+
- [inferis-ml](https://www.npmjs.com/package/inferis-ml) 1.0+
- Browser with WebGPU or WASM support

## License

MIT
