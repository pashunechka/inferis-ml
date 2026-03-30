import { describe, expect, it } from 'vitest';
import {
  BudgetExceededError,
  DeviceLostError,
  InferenceError,
  InferisError,
  InvalidStateTransitionError,
  ModelDisposedError,
  ModelLoadError,
  ModelNotReadyError,
  serializeError,
  TaskTimeoutError,
  WorkerError,
} from '../../src/core/errors.js';

describe('inferisError', () => {
  it('sets name, message, code', () => {
    const e = new InferisError('test message', 'TEST_CODE');
    expect(e.name).toBe('InferisError');
    expect(e.message).toBe('test message');
    expect(e.code).toBe('TEST_CODE');
    expect(e).toBeInstanceOf(Error);
    expect(e).toBeInstanceOf(InferisError);
  });

  it('serialize returns object without stack when stack is undefined', () => {
    const e = new InferisError('msg', 'CODE');
    e.stack = undefined;
    const s = e.serialize();
    expect(s).toEqual({ code: 'CODE', message: 'msg', name: 'InferisError' });
    expect('stack' in s).toBe(false);
  });

  it('serialize includes stack when present', () => {
    const e = new InferisError('msg', 'CODE');
    e.stack = 'Error: msg\n  at test.ts:1';
    const s = e.serialize();
    expect(s.stack).toBe('Error: msg\n  at test.ts:1');
  });

  describe('fromSerialized', () => {
    it('restores message and code', () => {
      const e = InferisError.fromSerialized({ code: 'MY_CODE', message: 'hello', name: 'InferisError' });
      expect(e.message).toBe('hello');
      expect(e.code).toBe('MY_CODE');
      expect(e.name).toBe('InferisError');
    });

    it('defaults code to UNKNOWN when absent', () => {
      const e = InferisError.fromSerialized({ message: 'x', name: 'InferisError' });
      expect(e.code).toBe('UNKNOWN');
    });

    it('restores stack when present', () => {
      const e = InferisError.fromSerialized({ code: 'C', message: 'm', name: 'N', stack: 'at foo:1' });
      expect(e.stack).toBe('at foo:1');
    });

    it('restores custom name', () => {
      const e = InferisError.fromSerialized({ code: 'C', message: 'm', name: 'CustomError' });
      expect(e.name).toBe('CustomError');
    });
  });
});

describe('error subclasses', () => {
  it('modelLoadError', () => {
    const e = new ModelLoadError('model-x', 'failed');
    expect(e.name).toBe('ModelLoadError');
    expect(e.code).toBe('MODEL_LOAD_ERROR');
    expect(e.modelId).toBe('model-x');
    expect(e.message).toBe('failed');
    expect(e).toBeInstanceOf(InferisError);
  });

  it('modelNotReadyError', () => {
    const e = new ModelNotReadyError('m', 'loading');
    expect(e.name).toBe('ModelNotReadyError');
    expect(e.code).toBe('MODEL_NOT_READY');
    expect(e.modelId).toBe('m');
    expect(e.message).toContain('loading');
  });

  it('modelDisposedError', () => {
    const e = new ModelDisposedError('m');
    expect(e.name).toBe('ModelDisposedError');
    expect(e.code).toBe('MODEL_DISPOSED');
    expect(e.modelId).toBe('m');
    expect(e.message).toContain('m');
  });

  it('inferenceError', () => {
    const e = new InferenceError('m', 'failed inference');
    expect(e.name).toBe('InferenceError');
    expect(e.code).toBe('INFERENCE_ERROR');
    expect(e.modelId).toBe('m');
    expect(e.message).toBe('failed inference');
  });

  it('budgetExceededError', () => {
    const e = new BudgetExceededError(500, 1024);
    expect(e.name).toBe('BudgetExceededError');
    expect(e.code).toBe('BUDGET_EXCEEDED');
    expect(e.requestedMB).toBe(500);
    expect(e.budgetMB).toBe(1024);
    expect(e.message).toContain('500');
    expect(e.message).toContain('1024');
  });

  it('taskTimeoutError', () => {
    const e = new TaskTimeoutError('req-1', 30000);
    expect(e.name).toBe('TaskTimeoutError');
    expect(e.code).toBe('TASK_TIMEOUT');
    expect(e.reqId).toBe('req-1');
    expect(e.message).toContain('req-1');
    expect(e.message).toContain('30000');
  });

  it('workerError', () => {
    const e = new WorkerError(2, 'crashed');
    expect(e.name).toBe('WorkerError');
    expect(e.code).toBe('WORKER_ERROR');
    expect(e.workerId).toBe(2);
    expect(e.message).toBe('crashed');
  });

  it('deviceLostError', () => {
    const e = new DeviceLostError('m', 'gpu hung');
    expect(e.name).toBe('DeviceLostError');
    expect(e.code).toBe('DEVICE_LOST');
    expect(e.modelId).toBe('m');
    expect(e.reason).toBe('gpu hung');
    expect(e.message).toContain('gpu hung');
  });

  it('invalidStateTransitionError', () => {
    const e = new InvalidStateTransitionError('idle', 'ready');
    expect(e.name).toBe('InvalidStateTransitionError');
    expect(e.code).toBe('INVALID_STATE_TRANSITION');
    expect(e.message).toContain('idle');
    expect(e.message).toContain('ready');
  });
});

describe('serializeError', () => {
  it('serializes InferisError', () => {
    const e = new InferisError('msg', 'CODE');
    const s = serializeError(e);
    expect(s.name).toBe('InferisError');
    expect(s.message).toBe('msg');
    expect(s.code).toBe('CODE');
  });

  it('serializes plain Error without stack when stack is undefined', () => {
    const e = new Error('plain');
    e.stack = undefined;
    const s = serializeError(e);
    expect(s.name).toBe('Error');
    expect(s.message).toBe('plain');
    expect(s.code).toBe('UNKNOWN');
    expect('stack' in s).toBe(false);
  });

  it('serializes plain Error with stack', () => {
    const e = new Error('plain');
    e.stack = 'at x:1';
    const s = serializeError(e);
    expect(s.stack).toBe('at x:1');
  });

  it('serializes non-Error value', () => {
    const s = serializeError('something went wrong');
    expect(s.name).toBe('Error');
    expect(s.message).toBe('something went wrong');
    expect(s.code).toBe('UNKNOWN');
  });

  it('serializes null', () => {
    const s = serializeError(null);
    expect(s.message).toBe('null');
  });
});
