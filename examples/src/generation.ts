import './shared.css';
import { createPool, readableToAsyncIter } from 'inferis';
import { transformersAdapter } from 'inferis/adapters/transformers';
import type { ModelHandle } from 'inferis';

const workerUrl = new URL('./inferis.worker.ts', import.meta.url);

const promptInput = document.getElementById('prompt-input') as HTMLInputElement;
const generateBtn = document.getElementById('generate-btn') as HTMLButtonElement;
const cancelBtn = document.getElementById('cancel-btn') as HTMLButtonElement;
const progressSection = document.getElementById('progress-section') as HTMLDivElement;
const progressFill = document.getElementById('progress-fill') as HTMLDivElement;
const progressMsg = document.getElementById('progress-msg') as HTMLSpanElement;
const progressFile = document.getElementById('progress-file') as HTMLSpanElement;
const outputEl = document.getElementById('gen-output') as HTMLPreElement;
const statusText = document.getElementById('status-text') as HTMLParagraphElement;
const cursor = document.getElementById('cursor') as HTMLSpanElement;

let model: ModelHandle<string> | null = null;
let busy = false;
let abortController: AbortController | null = null;

function formatBytes(n: number): string {
  if (n === 0) return '0 B';
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function setGenerating(on: boolean): void {
  busy = on;
  generateBtn.disabled = on;
  cancelBtn.hidden = !on;
  cursor.hidden = !on;
}

cancelBtn.addEventListener('click', () => {
  abortController?.abort();
});

generateBtn.addEventListener('click', async () => {
  if (busy) return;
  const prompt = promptInput.value.trim();
  if (!prompt) return;

  setGenerating(true);
  statusText.textContent = '';
  outputEl.textContent = '';

  const promptSpan = document.createElement('span');
  promptSpan.className = 'prompt-part';
  promptSpan.textContent = prompt;
  outputEl.appendChild(promptSpan);
  outputEl.appendChild(cursor);

  abortController = new AbortController();

  try {
    if (!model) {
      progressSection.hidden = false;
      progressFill.classList.add('indeterminate');
      progressMsg.textContent = 'Loading model…';
      progressFile.textContent = '';

      const pool = await createPool({
        adapter: transformersAdapter(),
        workerUrl,
      });

      model = await pool.load<string>('text-generation', {
        model: 'Xenova/gpt2',
        onProgress: (event) => {
          progressFill.classList.remove('indeterminate');
          const pct = event.total > 0 ? (event.loaded / event.total) * 100 : 0;
          progressFill.style.width = `${pct}%`;
          progressMsg.textContent = event.phase;
          progressFile.textContent = event.total > 0
            ? `${formatBytes(event.loaded)} / ${formatBytes(event.total)}`
            : '';
        },
      });

      progressFill.style.width = '100%';
      progressMsg.textContent = 'Model ready';
    }

    const genOpts = {
      do_sample: true,
      max_new_tokens: 120,
      repetition_penalty: 1.3,
      signal: abortController.signal,
      temperature: 0.9,
      top_k: 50,
    } as unknown as import('inferis').InferenceOptions;
    const stream = model.stream(prompt, genOpts);

    for await (const token of readableToAsyncIter(stream)) {
      const node = document.createTextNode(token as string);
      outputEl.insertBefore(node, cursor);
    }

    cursor.hidden = true;
    statusText.textContent = '';
  }
  catch (err: unknown) {
    cursor.hidden = true;
    const msg = String(err);
    if (!msg.includes('AbortError') && !msg.includes('abort')) {
      statusText.textContent = msg;
      statusText.classList.add('error');
    } else {
      statusText.textContent = 'Cancelled.';
    }
  }
  finally {
    setGenerating(false);
    abortController = null;
  }
});
