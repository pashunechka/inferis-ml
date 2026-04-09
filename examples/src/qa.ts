import './shared.css';
import { createPool } from 'inferis';
import { transformersAdapter } from 'inferis/adapters/transformers';
import type { ModelHandle } from 'inferis';

const workerUrl = new URL('./inferis.worker.ts', import.meta.url);

const contextInput = document.getElementById('context-input') as HTMLTextAreaElement;
const questionInput = document.getElementById('question-input') as HTMLInputElement;
const askBtn = document.getElementById('ask-btn') as HTMLButtonElement;
const progressSection = document.getElementById('progress-section') as HTMLDivElement;
const progressFill = document.getElementById('progress-fill') as HTMLDivElement;
const progressMsg = document.getElementById('progress-msg') as HTMLSpanElement;
const progressFile = document.getElementById('progress-file') as HTMLSpanElement;
const resultCard = document.getElementById('result-card') as HTMLDivElement;
const qaAnswer = document.getElementById('qa-answer') as HTMLDivElement;
const qaConfidencePct = document.getElementById('qa-confidence-pct') as HTMLSpanElement;
const qaBarFill = document.getElementById('qa-bar-fill') as HTMLDivElement;
const qaContextHighlight = document.getElementById('qa-context-highlight') as HTMLDivElement;
const statusText = document.getElementById('status-text') as HTMLParagraphElement;

type QaResult = { answer: string; end: number; score: number; start: number };

let model: ModelHandle<QaResult> | null = null;
let busy = false;

function formatBytes(n: number): string {
  if (n === 0) return '0 B';
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function confidenceColor(score: number): string {
  if (score > 0.7) return 'var(--success)';
  if (score >= 0.4) return 'var(--accent)';
  return 'var(--muted)';
}

function buildHighlightedContext(context: string, start: number, end: number): string {
  const before = escapeHtml(context.slice(0, start));
  const match = escapeHtml(context.slice(start, end));
  const after = escapeHtml(context.slice(end));
  return `${before}<mark class="qa-mark">${match}</mark>${after}`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

askBtn.addEventListener('click', async () => {
  if (busy) return;
  const context = contextInput.value.trim();
  const question = questionInput.value.trim();
  if (!context || !question) return;

  busy = true;
  askBtn.disabled = true;
  resultCard.hidden = true;
  statusText.textContent = '';

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

      model = await pool.load<QaResult>('question-answering', {
        model: 'Xenova/distilbert-base-uncased-distilled-squad',
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

    statusText.textContent = 'Extracting answer…';

    const raw = await model.run([question, context] as unknown);
    const result = Array.isArray(raw) ? raw[0] : raw;
    const { answer, score } = result;
    const start = answer ? context.indexOf(answer) : -1;
    const end = start >= 0 ? start + answer.length : -1;
    const pct = Math.round(score * 100);
    const color = confidenceColor(score);

    qaAnswer.textContent = answer;
    qaConfidencePct.textContent = `${pct}%`;
    qaConfidencePct.style.color = color;
    qaBarFill.style.width = `${pct}%`;
    qaBarFill.style.background = color;
    qaContextHighlight.innerHTML = start >= 0
      ? buildHighlightedContext(context, start, end)
      : escapeHtml(context);

    resultCard.hidden = false;
    statusText.textContent = '';
  }
  catch (err: unknown) {
    statusText.textContent = String(err);
    statusText.classList.add('error');
  }
  finally {
    busy = false;
    askBtn.disabled = false;
  }
});
