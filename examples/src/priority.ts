import './shared.css';
import inferisWorkerUrl from './inferis.worker.ts?worker&url';
import { createPool } from 'inferis';
import { transformersAdapter } from 'inferis/adapters/transformers';
import type { ModelHandle } from 'inferis';

type ClassificationResult = Array<{ label: string; score: number }>;
type Priority = 'high' | 'normal' | 'low';
type TaskStatus = 'waiting' | 'running' | 'done' | 'error';

interface Task {
  id: number;
  priority: Priority;
  sentence: string;
}

interface TaskState {
  elapsed: number | null;
  result: ClassificationResult[0] | null;
  startedAt: number | null;
  status: TaskStatus;
}

const TASKS: Task[] = [
  { id: 0, priority: 'high',   sentence: 'This product is absolutely fantastic!' },
  { id: 1, priority: 'low',    sentence: "I'm not sure how I feel about this." },
  { id: 2, priority: 'high',   sentence: 'The service was terrible and rude.' },
  { id: 3, priority: 'normal', sentence: 'It works fine, nothing special.' },
  { id: 4, priority: 'normal', sentence: "Best experience I've ever had!" },
];

const PRIORITY_COLOR: Record<Priority, string> = {
  high:   '#f87171',
  low:    '#6366f1',
  normal: '#fbbf24',
};

const workerUrl = inferisWorkerUrl;

const runBtn          = document.getElementById('run-btn')          as HTMLButtonElement;
const resetBtn        = document.getElementById('reset-btn')        as HTMLButtonElement;
const progressSection = document.getElementById('progress-section') as HTMLDivElement;
const progressFill    = document.getElementById('progress-fill')    as HTMLDivElement;
const progressMsg     = document.getElementById('progress-msg')     as HTMLSpanElement;
const progressFile    = document.getElementById('progress-file')    as HTMLSpanElement;
const taskList        = document.getElementById('task-list')        as HTMLUListElement;

let model: ModelHandle<ClassificationResult> | null = null;
let running = false;

const states = new Map<number, TaskState>(
  TASKS.map((t) => [t.id, { elapsed: null, result: null, startedAt: null, status: 'waiting' }]),
);

function formatBytes(n: number): string {
  if (n === 0) return '0 B';
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function renderTasks(): void {
  taskList.innerHTML = '';

  for (const task of TASKS) {
    const state = states.get(task.id)!;

    const li = document.createElement('li');
    li.className = 'pq-task';
    li.dataset['id'] = String(task.id);

    const dot = document.createElement('span');
    dot.className = `pq-dot pq-dot--${state.status}`;

    const badge = document.createElement('span');
    badge.className = 'pq-badge';
    badge.textContent = task.priority;
    badge.style.color = PRIORITY_COLOR[task.priority];
    badge.style.borderColor = PRIORITY_COLOR[task.priority] + '55';
    badge.style.background = PRIORITY_COLOR[task.priority] + '18';

    const sentence = document.createElement('span');
    sentence.className = 'pq-sentence';
    sentence.textContent = task.sentence;

    const statusEl = document.createElement('span');
    statusEl.className = `pq-status pq-status--${state.status}`;
    statusEl.textContent = state.status;

    const right = document.createElement('div');
    right.className = 'pq-right';

    if (state.status === 'done' && state.result) {
      const label = state.result.label.toUpperCase() === 'POSITIVE' ? 'Positive' : 'Negative';
      const pct   = Math.round(state.result.score * 100);
      const color = label === 'Positive' ? 'var(--success)' : 'var(--danger)';

      const result = document.createElement('span');
      result.className = 'pq-result';
      result.innerHTML = `<span style="color:${color};font-weight:600">${label}</span> <span class="pq-conf">${pct}%</span>`;
      right.appendChild(result);
    }

    if (state.elapsed !== null) {
      const time = document.createElement('span');
      time.className = 'pq-time';
      time.textContent = `${state.elapsed} ms`;
      right.appendChild(time);
    }

    li.appendChild(dot);
    li.appendChild(badge);
    li.appendChild(sentence);
    li.appendChild(statusEl);
    li.appendChild(right);
    taskList.appendChild(li);
  }
}

function updateTaskStatus(id: number, patch: Partial<TaskState>): void {
  const s = states.get(id)!;
  Object.assign(s, patch);
  const li = taskList.querySelector<HTMLLIElement>(`[data-id="${id}"]`);
  if (li) {
    const task = TASKS[id];
    const state = states.get(id)!;

    const dot = li.querySelector('.pq-dot')!;
    dot.className = `pq-dot pq-dot--${state.status}`;

    const statusEl = li.querySelector('.pq-status')!;
    statusEl.className = `pq-status pq-status--${state.status}`;
    statusEl.textContent = state.status;

    const right = li.querySelector('.pq-right')!;
    right.innerHTML = '';

    if (state.status === 'done' && state.result) {
      const label = state.result.label.toUpperCase() === 'POSITIVE' ? 'Positive' : 'Negative';
      const pct   = Math.round(state.result.score * 100);
      const color = label === 'Positive' ? 'var(--success)' : 'var(--danger)';

      const result = document.createElement('span');
      result.className = 'pq-result';
      result.innerHTML = `<span style="color:${color};font-weight:600">${label}</span> <span class="pq-conf">${pct}%</span>`;
      right.appendChild(result);
    }

    if (state.elapsed !== null) {
      const time = document.createElement('span');
      time.className = 'pq-time';
      time.textContent = `${state.elapsed} ms`;
      right.appendChild(time);
    }

    void task;
  }
}

async function ensureModel(): Promise<ModelHandle<ClassificationResult>> {
  if (model) return model;

  progressSection.hidden = false;
  progressFill.classList.add('indeterminate');
  progressMsg.textContent = 'Loading model…';
  progressFile.textContent = '';

  const pool = await createPool({
    adapter: transformersAdapter(),
    workerUrl,
  });

  model = await pool.load<ClassificationResult>('text-classification', {
    dtype: 'fp32',
    model: 'Xenova/distilbert-base-uncased-finetuned-sst-2-english',
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

  return model;
}

runBtn.addEventListener('click', async () => {
  if (running) return;
  running = true;
  runBtn.disabled = true;
  resetBtn.disabled = true;

  for (const task of TASKS) {
    states.set(task.id, { elapsed: null, result: null, startedAt: null, status: 'waiting' });
  }
  renderTasks();

  try {
    const m = await ensureModel();
    const enqueuedAt = Date.now();

    const promises = TASKS.map((task) =>
      m.run(task.sentence, { priority: task.priority }).then((raw) => {
        const result = Array.isArray(raw) ? raw[0] : (raw as ClassificationResult)[0];
        updateTaskStatus(task.id, {
          elapsed: Date.now() - enqueuedAt,
          result,
          status: 'done',
        });
      }).catch((err: unknown) => {
        updateTaskStatus(task.id, { status: 'error' });
        console.error(err);
      }),
    );

    for (const task of TASKS) {
      updateTaskStatus(task.id, { startedAt: Date.now(), status: 'running' });
    }

    await Promise.allSettled(promises);
  } catch (err: unknown) {
    console.error(err);
  } finally {
    running = false;
    runBtn.disabled = false;
    resetBtn.disabled = false;
  }
});

resetBtn.addEventListener('click', () => {
  if (running) return;
  model = null;
  progressSection.hidden = true;
  progressFill.style.width = '0%';
  progressFill.classList.remove('indeterminate');
  progressMsg.textContent = '';
  progressFile.textContent = '';
  for (const task of TASKS) {
    states.set(task.id, { elapsed: null, result: null, startedAt: null, status: 'waiting' });
  }
  renderTasks();
});

renderTasks();
