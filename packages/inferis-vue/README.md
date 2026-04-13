# inferis-vue

[![npm version](https://img.shields.io/npm/v/inferis-vue.svg)](https://www.npmjs.com/package/inferis-vue)

Vue 3 composables and plugin for [inferis-ml](https://www.npmjs.com/package/inferis-ml) -- run AI models directly in the browser with WebGPU/WASM.

## Install

```bash
npm install inferis-vue inferis-ml
```

## Quick Start

```vue
<script setup lang="ts">
import { provideInferis, useModel, useStream } from 'inferis-vue';
import { webLlmAdapter } from 'inferis-ml/adapters/web-llm';

provideInferis({ adapter: webLlmAdapter() });

const { model, state, progress } = useModel('text-generation', {
  model: 'Llama-3.2-1B-Instruct-q4f16_1-MLC',
  autoLoad: true,
});

const { text, isStreaming, start, stop } = useStream(model);

function generate() {
  start({ prompt: 'Explain quantum computing in 3 sentences' });
}
</script>

<template>
  <div v-if="state === 'loading'">
    Loading model... {{ progress ? Math.round((progress.loaded / (progress.total || 1)) * 100) : 0 }}%
  </div>
  <div v-else-if="state === 'error'">Failed to load model</div>
  <div v-else>
    <button @click="generate">Generate</button>
    <button v-if="isStreaming" @click="stop">Stop</button>
    <p>{{ text }}</p>
  </div>
</template>
```

## Setup

Two ways to provide the inferis context:

### Option 1: Vue Plugin (global)

```ts
import { createApp } from 'vue';
import { inferisPlugin } from 'inferis-vue';
import { webLlmAdapter } from 'inferis-ml/adapters/web-llm';
import App from './App.vue';

const app = createApp(App);
app.use(inferisPlugin, {
  adapter: webLlmAdapter(),
  poolConfig: { maxMemoryMB: 4096, maxWorkers: 2 },
});
app.mount('#app');
```

### Option 2: provideInferis (scoped)

```vue
<script setup>
import { provideInferis } from 'inferis-vue';
import { webLlmAdapter } from 'inferis-ml/adapters/web-llm';

provideInferis({ adapter: webLlmAdapter() });
</script>
```

Child components can then use any composable.

---

## API Reference

### `inferisPlugin`

Vue plugin. Installs via `app.use(inferisPlugin, options)`.

| Option | Type | Description |
|--------|------|-------------|
| `adapter` | `ModelAdapterFactory` | Required. Adapter from `inferis-ml/adapters/*` |
| `poolConfig` | `Partial<PoolConfig>` | Optional pool settings (memory limit, workers, device, etc.) |

### `provideInferis(options)`

Call in a component's `setup()` to provide inferis context to descendants. Same options as the plugin. Automatically terminates the pool when the component scope is disposed.

---

### `useInferis()`

Raw access to the worker pool.

```ts
const { pool, isReady } = useInferis();
```

| Field | Type | Description |
|-------|------|-------------|
| `pool` | `ShallowRef<WorkerPool \| null>` | Pool instance, `null` while initializing |
| `isReady` | `ComputedRef<boolean>` | `true` when pool is created |

---

### `useCapabilities()`

Device capability detection (WebGPU, WASM SIMD, SharedWorker, etc.).

```ts
const { capabilities, isLoading } = useCapabilities();

if (capabilities.value?.webgpu.supported) {
  console.log('GPU:', capabilities.value.webgpu.adapter?.vendor);
}
```

| Field | Type | Description |
|-------|------|-------------|
| `capabilities` | `ShallowRef<CapabilityReport \| null>` | Detection result |
| `isLoading` | `ComputedRef<boolean>` | `true` while detecting |

---

### `useModel(task, config)`

Load and manage a model lifecycle. Auto-disposes on scope destruction.

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
| `model` | `ShallowRef<ModelHandle \| null>` | Model handle for inference |
| `state` | `Ref<ModelState \| 'pending'>` | Current lifecycle state |
| `progress` | `ShallowRef<LoadProgressEvent \| null>` | Download/load progress |
| `error` | `ShallowRef<Error \| null>` | Load error |
| `load()` | `() => Promise<void>` | Manually trigger loading |
| `dispose()` | `() => Promise<void>` | Unload model and free memory |

Progress example:

```vue
<template>
  <div v-if="state === 'loading' && progress">
    <div :style="{ width: `${pct}%`, height: '4px', background: '#3b82f6' }" />
    <p>{{ progress.phase }} -- {{ pct }}%</p>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { useModel } from 'inferis-vue';

const { state, progress } = useModel('text-generation', {
  model: 'Llama-3.2-1B-Instruct-q4f16_1-MLC',
  autoLoad: true,
});

const pct = computed(() =>
  progress.value ? Math.round((progress.value.loaded / (progress.value.total || 1)) * 100) : 0
);
</script>
```

---

### `useInference<T>(model)`

Single (non-streaming) inference request.

```ts
const { result, error, isLoading, run, reset } = useInference(model);

const output = await run({ text: 'This movie is great!' });
```

| Return | Type | Description |
|--------|------|-------------|
| `result` | `ShallowRef<T \| null>` | Last inference result |
| `error` | `ShallowRef<Error \| null>` | Last error |
| `isLoading` | `Ref<boolean>` | Request in flight |
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
| `chunks` | `ShallowRef<T[]>` | All received chunks |
| `text` | `Ref<string>` | Accumulated text (for string chunks) |
| `isStreaming` | `Ref<boolean>` | Stream active |
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

`inferis-ml` ships three adapters. Pass any of them to the plugin or `provideInferis`:

```ts
import { webLlmAdapter } from 'inferis-ml/adapters/web-llm';
import { transformersAdapter } from 'inferis-ml/adapters/transformers';
import { onnxAdapter } from 'inferis-ml/adapters/onnx';
```

## Examples

### Image Classification

```vue
<script setup>
import { useModel, useInference } from 'inferis-vue';

const { model } = useModel('image-classification', {
  model: 'google/vit-base-patch16-224',
  autoLoad: true,
});

const { result, isLoading, run } = useInference(model);

async function classify(event) {
  const file = event.target.files?.[0];
  if (file) await run(file);
}
</script>

<template>
  <input type="file" accept="image/*" @change="classify" />
  <p v-if="isLoading">Classifying...</p>
  <p v-for="r in result" :key="r.label">{{ r.label }}: {{ (r.score * 100).toFixed(1) }}%</p>
</template>
```

### Capability Gate

```vue
<script setup>
import { useCapabilities } from 'inferis-vue';

const { capabilities, isLoading } = useCapabilities();
</script>

<template>
  <p v-if="isLoading">Detecting device capabilities...</p>
  <p v-else-if="!capabilities?.webgpu.supported && !capabilities?.wasm.supported">
    Your browser does not support WebGPU or WASM.
  </p>
  <slot v-else />
</template>
```

### Memory Monitor

```vue
<script setup>
import { computed } from 'vue';
import { useMemoryBudget } from 'inferis-vue';

const { totalMB, allocatedMB } = useMemoryBudget();
const pct = computed(() => totalMB.value ? Math.round((allocatedMB.value / totalMB.value) * 100) : 0);
</script>

<template>
  <div>
    <div :style="{ width: `${pct}%`, height: '4px', background: pct > 80 ? '#ef4444' : '#22c55e' }" />
    <p>{{ allocatedMB }} / {{ totalMB }} MB</p>
  </div>
</template>
```

## Nuxt 3

ML inference runs in the browser via Web Workers -- there is no server-side model loading. Use `<ClientOnly>` to prevent SSR rendering of components that use inferis composables.

```vue
<!-- pages/ai.vue -->
<template>
  <ClientOnly>
    <AiChat />
  </ClientOnly>
</template>
```

Create a Nuxt plugin for global setup:

```ts
// plugins/inferis.client.ts
import { inferisPlugin } from 'inferis-vue';
import { webLlmAdapter } from 'inferis-ml/adapters/web-llm';

export default defineNuxtPlugin((nuxtApp) => {
  nuxtApp.vueApp.use(inferisPlugin, {
    adapter: webLlmAdapter(),
  });
});
```

The `.client.ts` suffix ensures the plugin only runs in the browser.

## Requirements

- Vue 3.3+
- [inferis-ml](https://www.npmjs.com/package/inferis-ml) 1.0+
- Browser with WebGPU or WASM support

## License

MIT
