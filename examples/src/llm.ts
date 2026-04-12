import './shared.css';
import webllmWorkerUrl from './webllm.worker.ts?worker&url';
import { createPool, readableToAsyncIter } from 'inferis-ml';
import type { ModelHandle } from 'inferis-ml';

const workerUrl = webllmWorkerUrl;

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

const MODEL_ID = 'SmolLM2-360M-Instruct-q4f16_1-MLC';

const messagesEl = document.getElementById('messages') as HTMLDivElement;
const inputEl = document.getElementById('chat-input') as HTMLTextAreaElement;
const sendBtn = document.getElementById('send-btn') as HTMLButtonElement;
const cancelBtn = document.getElementById('cancel-btn') as HTMLButtonElement;
const clearBtn = document.getElementById('clear-btn') as HTMLButtonElement;
const loadBtn = document.getElementById('load-btn') as HTMLButtonElement;
const loadPrompt = document.getElementById('load-prompt') as HTMLDivElement;
const progressArea = document.getElementById('progress-area') as HTMLDivElement;
const progressFill = document.getElementById('progress-fill') as HTMLDivElement;
const progressMsg = document.getElementById('progress-msg') as HTMLSpanElement;
const progressFile = document.getElementById('progress-file') as HTMLSpanElement;
const statusText = document.getElementById('status-text') as HTMLParagraphElement;

const history: ChatMessage[] = [];
let model: ModelHandle<string> | null = null;
let busy = false;
let abortController: AbortController | null = null;

function formatBytes(n: number): string {
  if (n === 0) return '0 B';
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function scrollToBottom(): void {
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function appendMessage(role: 'user' | 'assistant', content: string): HTMLDivElement {
  const wrapper = document.createElement('div');
  wrapper.className = `msg msg-${role}`;

  const label = document.createElement('div');
  label.className = 'msg-label';
  label.textContent = role === 'user' ? 'You' : 'Assistant';

  const body = document.createElement('div');
  body.className = 'msg-body';
  body.textContent = content;

  wrapper.appendChild(label);
  wrapper.appendChild(body);
  messagesEl.appendChild(wrapper);
  scrollToBottom();
  return wrapper;
}

function setGenerating(on: boolean): void {
  busy = on;
  sendBtn.disabled = on;
  cancelBtn.hidden = !on;
  inputEl.disabled = on;
}

function setChatEnabled(on: boolean): void {
  sendBtn.disabled = !on;
  inputEl.disabled = !on;
  if (on) inputEl.focus();
}

async function loadModel(): Promise<void> {
  if (model) return;

  loadBtn.disabled = true;
  loadPrompt.hidden = true;
  progressArea.hidden = false;
  progressFill.classList.add('indeterminate');
  progressMsg.textContent = 'Loading model\u2026';
  progressFile.textContent = '';

  const pool = await createPool({
    adapter: (await import('inferis-ml/adapters/web-llm')).webLlmAdapter(),
    workerUrl,
    maxWorkers: 1,
  });

  model = await pool.load<string>('text-generation', {
    model: MODEL_ID,
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
  setChatEnabled(true);
}

async function sendMessage(): Promise<void> {
  if (busy) return;
  const text = inputEl.value.trim();
  if (!text) return;

  inputEl.value = '';
  inputEl.style.height = 'auto';
  appendMessage('user', text);
  history.push({ role: 'user', content: text });

  setGenerating(true);
  statusText.textContent = '';
  statusText.classList.remove('error');

  abortController = new AbortController();

  const assistantEl = appendMessage('assistant', '');
  const bodyEl = assistantEl.querySelector('.msg-body') as HTMLDivElement;
  bodyEl.innerHTML = '<span class="cursor"></span>';

  try {
    if (!model) return;

    const messages: ChatMessage[] = [
      { role: 'system', content: 'You are a helpful, concise assistant.' },
      ...history,
    ];

    const stream = model!.stream(
      { messages, temperature: 0.7, max_tokens: 512 },
      { signal: abortController.signal } as unknown as import('inferis-ml').InferenceOptions,
    );

    let fullResponse = '';
    for await (const token of readableToAsyncIter(stream)) {
      fullResponse += token as string;
      bodyEl.textContent = fullResponse;
      const cursorSpan = document.createElement('span');
      cursorSpan.className = 'cursor';
      bodyEl.appendChild(cursorSpan);
      scrollToBottom();
    }

    bodyEl.textContent = fullResponse;
    history.push({ role: 'assistant', content: fullResponse });
  }
  catch (err: unknown) {
    const msg = String(err);
    if (!msg.includes('AbortError') && !msg.includes('abort')) {
      statusText.textContent = msg;
      statusText.classList.add('error');
      bodyEl.textContent = 'Error generating response.';
    }
    else {
      bodyEl.textContent = bodyEl.textContent?.replace(/\u2588$/, '') || 'Cancelled.';
      const partial = bodyEl.textContent;
      if (partial && partial !== 'Cancelled.') {
        history.push({ role: 'assistant', content: partial });
      }
      statusText.textContent = 'Cancelled.';
    }
  }
  finally {
    setGenerating(false);
    abortController = null;
  }
}

loadBtn.addEventListener('click', () => {
  loadModel().catch((err) => {
    statusText.textContent = String(err);
    statusText.classList.add('error');
    loadBtn.disabled = false;
    loadPrompt.hidden = false;
    progressArea.hidden = true;
  });
});

cancelBtn.addEventListener('click', () => {
  abortController?.abort();
});

clearBtn.addEventListener('click', () => {
  history.length = 0;
  messagesEl.innerHTML = '';
  statusText.textContent = '';
  statusText.classList.remove('error');
});

sendBtn.addEventListener('click', sendMessage);

inputEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

inputEl.addEventListener('input', () => {
  inputEl.style.height = 'auto';
  inputEl.style.height = `${Math.min(inputEl.scrollHeight, 150)}px`;
});

setChatEnabled(false);
