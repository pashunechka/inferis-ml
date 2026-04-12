/// <reference lib="webworker" />
// Vite processes this as the worker entry point.
// The adapter factory is imported statically (not sent via postMessage)
// so it avoids the structured clone limitation.
import { transformersAdapter } from 'inferis-ml/adapters/transformers';
import { registerAdapterFactory } from 'inferis-ml/worker';

registerAdapterFactory(transformersAdapter());
