import { describe, expect, it, vi } from 'vitest';
import { Scheduler } from '../../src/core/scheduler.js';

describe('scheduler extras', () => {
  it('reset clears all worker state', () => {
    const s = new Scheduler();
    s.addWorker(0);
    s.addWorker(1);
    s.notifyModelLoaded(0, 'model-a');
    s.reset();
    expect(s.workerIds).toHaveLength(0);
    expect(s.workerLoadFor(0)).toBe(0);
  });

  it('priorityWeight returns correct weights', () => {
    expect(Scheduler.priorityWeight('high')).toBe(2);
    expect(Scheduler.priorityWeight('normal')).toBe(1);
    expect(Scheduler.priorityWeight('low')).toBe(0);
  });

  it('notifyModelUnloaded removes model from worker', () => {
    const s = new Scheduler();
    s.addWorker(0);
    s.notifyModelLoaded(0, 'model-a');
    s.notifyModelUnloaded(0, 'model-a');
    const task = {
      enqueuedAt: Date.now(),
      execute: vi.fn(),
      modelId: 'model-a',
      priority: 'normal' as const,
      reject: vi.fn(),
      reqId: 'r1',
    };
    s.enqueue(task);
    expect(task.execute).toHaveBeenCalledWith(0);
  });

  it('drainNext with affinity task picks affinity task over first', () => {
    const s = new Scheduler();
    s.addWorker(0);
    for (let i = 0; i < 4; i++) {
      s.enqueue({ enqueuedAt: Date.now(), execute: vi.fn(), modelId: 'other', priority: 'normal', reject: vi.fn(), reqId: `fill-${i}` });
    }
    s.notifyModelLoaded(0, 'model-a');

    const normalTask = { enqueuedAt: Date.now(), execute: vi.fn(), modelId: 'other', priority: 'normal' as const, reject: vi.fn(), reqId: 'n1' };
    const affinityTask = { enqueuedAt: Date.now(), execute: vi.fn(), modelId: 'model-a', priority: 'normal' as const, reject: vi.fn(), reqId: 'a1' };
    s.enqueue(normalTask);
    s.enqueue(affinityTask);

    s.notifyTaskComplete(0);
    expect(affinityTask.execute).toHaveBeenCalledWith(0);
    expect(normalTask.execute).not.toHaveBeenCalled();
  });

  it('notifyTaskComplete on unknown worker is a no-op', () => {
    const s = new Scheduler();
    expect(() => s.notifyTaskComplete(999)).not.toThrow();
  });

  it('workerLoadFor returns 0 for unknown worker', () => {
    const s = new Scheduler();
    expect(s.workerLoadFor(999)).toBe(0);
  });

  it('low priority task is dispatched after high and normal', () => {
    const s = new Scheduler();
    s.addWorker(0);
    for (let i = 0; i < 4; i++) s.enqueue({ enqueuedAt: Date.now(), execute: vi.fn(), modelId: 'm', priority: 'normal', reject: vi.fn(), reqId: `f${i}` });

    const low = { enqueuedAt: Date.now(), execute: vi.fn(), modelId: 'm', priority: 'low' as const, reject: vi.fn(), reqId: 'low1' };
    const high = { enqueuedAt: Date.now(), execute: vi.fn(), modelId: 'm', priority: 'high' as const, reject: vi.fn(), reqId: 'hi1' };
    const normal = { enqueuedAt: Date.now(), execute: vi.fn(), modelId: 'm', priority: 'normal' as const, reject: vi.fn(), reqId: 'no1' };
    s.enqueue(low);
    s.enqueue(high);
    s.enqueue(normal);

    s.notifyTaskComplete(0);
    expect(high.execute).toHaveBeenCalled();

    s.notifyTaskComplete(0);
    expect(normal.execute).toHaveBeenCalled();

    s.notifyTaskComplete(0);
    expect(low.execute).toHaveBeenCalled();
  });
});
