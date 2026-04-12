# Getting Started

## Installation

```bash
npm install inferis-ml
```

Install the adapter you need:

```bash
npm install @huggingface/transformers   # transformersAdapter
npm install @mlc-ai/web-llm             # webLlmAdapter
npm install onnxruntime-web             # onnxAdapter
```

## Bundler Configuration

### Vite

```ts
// vite.config.ts
export default {
  worker: { format: 'es' },
};
```

### webpack 5

```js
// webpack.config.js
module.exports = {
  experiments: { asyncWebAssembly: true },
};
```

### Vanilla (no bundler)

Use an importmap:

```html
<script type="importmap">
{
  "imports": {
    "inferis-ml": "https://cdn.jsdelivr.net/npm/inferis-ml/dist/index.js",
    "inferis-ml/adapters/transformers": "https://cdn.jsdelivr.net/npm/inferis-ml/dist/adapters/transformers.js"
  }
}
</script>
<script type="module">
  import { createPool } from 'inferis-ml';
  import { transformersAdapter } from 'inferis-ml/adapters/transformers';
  // ...
</script>
```

## Step 1 — Create a pool

```ts
import { createPool } from 'inferis-ml';
import { transformersAdapter } from 'inferis-ml/adapters/transformers';

const pool = await createPool({
  adapter: transformersAdapter(),
});
```

This spawns `navigator.hardwareConcurrency - 1` Web Workers (min 1) and detects WebGPU availability.

## Step 2 — Load a model

```ts
const model = await pool.load<number[][]>('feature-extraction', {
  model: 'mixedbread-ai/mxbai-embed-xsmall-v1',
  onProgress: ({ phase, loaded, total }) => {
    console.log(`${phase}: ${total > 0 ? Math.round(loaded / total * 100) : 0}%`);
  },
});
```

The model is downloaded once and cached in the browser (by transformers.js). Subsequent page loads use the cache.

## Step 3 — Run inference

```ts
const embeddings = await model.run(['Hello world', 'Another sentence']);
// number[][]
```

## Step 4 — Stream tokens (LLM)

```ts
import { webLlmAdapter } from 'inferis-ml/adapters/web-llm';

const llmPool = await createPool({
  adapter: webLlmAdapter(),
  maxWorkers: 1,  // one GPU context
});

const llm = await llmPool.load<string>('text-generation', {
  model: 'Llama-3.2-3B-Instruct-q4f32_1-MLC',
});

const output = document.getElementById('output');
const stream = llm.stream({
  messages: [{ role: 'user', content: 'Hello!' }],
});

for await (const token of stream) {
  output.textContent += token;
}
```

## Step 5 — Cleanup

```ts
await model.dispose();    // unload model, free memory
await pool.terminate();   // terminate workers
```

In a Single Page App, call `terminate()` before route unmount:

```ts
// React
useEffect(() => {
  return () => { pool.terminate(); };
}, []);
```

## Full Example (React)

```tsx
import { useEffect, useRef, useState } from 'react';
import { createPool, WorkerPool } from 'inferis-ml';
import { transformersAdapter } from 'inferis-ml/adapters/transformers';

function EmbeddingDemo() {
  const poolRef = useRef<WorkerPool | null>(null);
  const [loading, setLoading] = useState(true);
  const [result, setResult] = useState<number[][] | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function init() {
      const pool = await createPool({ adapter: transformersAdapter() });
      if (cancelled) { pool.terminate(); return; }
      poolRef.current = pool;

      const model = await pool.load<number[][]>('feature-extraction', {
        model: 'mixedbread-ai/mxbai-embed-xsmall-v1',
      });

      const embeddings = await model.run(['Hello world']);
      if (!cancelled) {
        setResult(embeddings);
        setLoading(false);
      }
    }

    init();
    return () => {
      cancelled = true;
      poolRef.current?.terminate();
    };
  }, []);

  if (loading) return <p>Loading model...</p>;
  return <pre>{JSON.stringify(result?.[0]?.slice(0, 5), null, 2)}</pre>;
}
```
