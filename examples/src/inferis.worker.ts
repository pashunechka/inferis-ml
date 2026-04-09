/// <reference lib="webworker" />
// Vite processes this as the worker entry point.
// The adapter factory is imported statically (not sent via postMessage)
// so it avoids the structured clone limitation.
import { transformersAdapter } from '../../src/adapters/transformers.ts';
import { registerAdapterFactory } from '../../src/worker/dedicated.worker.ts';

registerAdapterFactory(transformersAdapter());
