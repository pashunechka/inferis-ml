/// <reference lib="webworker" />
// Vite processes this as the worker entry point.
// The adapter factory is imported statically (not sent via postMessage)
// so it avoids the structured clone limitation.
import { transformersAdapter } from 'inferis/adapters/transformers';
import { registerAdapterFactory } from 'inferis/worker';

registerAdapterFactory(transformersAdapter());
