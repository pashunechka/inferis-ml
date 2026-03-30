import type { ModelEntry, ScheduledTask } from '../../src/core/types.js';
import { describe, expect, it, vi } from 'vitest';
import { Scheduler } from '../../src/core/scheduler.js';

function makeTask(overrides: Partial<ScheduledTask> = {}): ScheduledTask {
  return {
    enqueuedAt: Date.now(),
    execute: vi.fn(),
    modelId: 'model-a',
    priority: 'normal',
    reject: vi.fn(),
    reqId: Math.random().toString(36).slice(2),
    ...overrides,
  };
}

function emptyModels(): Map<string, ModelEntry> {
  return new Map();
}

describe('scheduler', () => {
  describe('addWorker / removeWorker', () => {
    it('registers workers', () => {
      const s = new Scheduler();
      s.addWorker(0);
      s.addWorker(1);
      expect(s.workerIds).toContain(0);
      expect(s.workerIds).toContain(1);
    });

    it('removes workers', () => {
      const s = new Scheduler();
      s.addWorker(0);
      s.removeWorker(0);
      expect(s.workerIds).not.toContain(0);
    });
  });

  describe('enqueue', () => {
    it('dispatches immediately to idle worker', () => {
      const s = new Scheduler();
      s.addWorker(0);
      const task = makeTask();
      s.enqueue(task, emptyModels());
      expect(task.execute).toHaveBeenCalledWith(0);
    });

    it('queues task when all workers are saturated', () => {
      const s = new Scheduler();
      s.addWorker(0);
      // saturate worker 0 with concurrencyPerWorker tasks
      for (let i = 0; i < 4; i++) {
        s.enqueue(makeTask(), emptyModels());
      }
      expect(s.workerLoadFor(0)).toBe(4);

      const overflow = makeTask();
      s.enqueue(overflow, emptyModels());
      // task was queued, not dispatched
      expect(overflow.execute).not.toHaveBeenCalled();
      expect(s.queueDepth).toBe(1);
    });

    it('drains queue when worker completes a task', () => {
      const s = new Scheduler();
      s.addWorker(0);
      for (let i = 0; i < 4; i++) {
        s.enqueue(makeTask(), emptyModels());
      }

      const queued = makeTask();
      s.enqueue(queued, emptyModels());
      expect(queued.execute).not.toHaveBeenCalled();

      s.notifyTaskComplete(0, emptyModels());
      expect(queued.execute).toHaveBeenCalledWith(0);
      expect(s.queueDepth).toBe(0);
    });
  });

  describe('model affinity', () => {
    it('prefers worker with model already loaded', () => {
      const s = new Scheduler();
      s.addWorker(0);
      s.addWorker(1);
      s.notifyModelLoaded(1, 'model-a');

      const task = makeTask({ modelId: 'model-a' });
      s.enqueue(task, emptyModels());

      expect(task.execute).toHaveBeenCalledWith(1);
    });

    it('falls back to least-loaded worker when no affinity match', () => {
      const s = new Scheduler();
      s.addWorker(0);
      s.addWorker(1);
      // enqueue 3 tasks: task1->w0, task2->w1 (w0 at 1, w1 at 0), task3->w0 (tie->w0 wins)
      // result: w0 load=2, w1 load=1
      s.enqueue(makeTask(), emptyModels());
      s.enqueue(makeTask(), emptyModels());
      s.enqueue(makeTask(), emptyModels());

      expect(s.workerLoadFor(0)).toBe(2);
      expect(s.workerLoadFor(1)).toBe(1);

      // task for unknown model should go to worker 1 (load=1 < 2)
      const task = makeTask({ modelId: 'model-x' });
      s.enqueue(task, emptyModels());
      expect(task.execute).toHaveBeenCalledWith(1);
    });
  });

  describe('priority ordering', () => {
    it('dispatches high-priority tasks before normal', () => {
      const s = new Scheduler();
      s.addWorker(0);
      // saturate
      for (let i = 0; i < 4; i++) s.enqueue(makeTask(), emptyModels());

      const normalTask = makeTask({ priority: 'normal' });
      const highTask = makeTask({ priority: 'high' });

      s.enqueue(normalTask, emptyModels());
      s.enqueue(highTask, emptyModels());

      s.notifyTaskComplete(0, emptyModels());
      expect(highTask.execute).toHaveBeenCalled();
      expect(normalTask.execute).not.toHaveBeenCalled();
    });
  });

  describe('queueDepth', () => {
    it('returns total tasks across all priority queues', () => {
      const s = new Scheduler();
      s.addWorker(0);
      for (let i = 0; i < 4; i++) s.enqueue(makeTask(), emptyModels());

      s.enqueue(makeTask({ priority: 'high' }), emptyModels());
      s.enqueue(makeTask({ priority: 'low' }), emptyModels());
      s.enqueue(makeTask({ priority: 'normal' }), emptyModels());

      expect(s.queueDepth).toBe(3);
    });
  });
});
