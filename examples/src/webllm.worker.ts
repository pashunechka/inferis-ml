/// <reference lib="webworker" />
import { webLlmAdapter } from 'inferis-ml/adapters/web-llm';
import { registerAdapterFactory } from 'inferis-ml/worker';

registerAdapterFactory(webLlmAdapter());
