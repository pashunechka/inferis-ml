/// <reference lib="webworker" />
import { webLlmAdapter } from 'inferis/adapters/web-llm';
import { registerAdapterFactory } from 'inferis/worker';

registerAdapterFactory(webLlmAdapter());
