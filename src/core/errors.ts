import type { SerializedError } from './types.js';

export class InferisError extends Error {
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = 'InferisError';
    this.code = code;
  }

  static fromSerialized(err: SerializedError): InferisError {
    const instance = new InferisError(err.message, err.code ?? 'UNKNOWN');
    instance.name = err.name;
    if (err.stack)
      instance.stack = err.stack;
    return instance;
  }

  serialize(): SerializedError {
    const result: SerializedError = {
      code: this.code,
      message: this.message,
      name: this.name,
    };
    if (this.stack !== undefined) {
      return { ...result, stack: this.stack };
    }
    return result;
  }
}

export class ModelLoadError extends InferisError {
  readonly modelId: string;

  constructor(modelId: string, message: string) {
    super(message, 'MODEL_LOAD_ERROR');
    this.name = 'ModelLoadError';
    this.modelId = modelId;
  }
}

export class ModelNotReadyError extends InferisError {
  readonly modelId: string;

  constructor(modelId: string, state: string) {
    super(`Model "${modelId}" is not ready (state: ${state})`, 'MODEL_NOT_READY');
    this.name = 'ModelNotReadyError';
    this.modelId = modelId;
  }
}

export class ModelDisposedError extends InferisError {
  readonly modelId: string;

  constructor(modelId: string) {
    super(`Model "${modelId}" has been disposed`, 'MODEL_DISPOSED');
    this.name = 'ModelDisposedError';
    this.modelId = modelId;
  }
}

export class InferenceError extends InferisError {
  readonly modelId: string;

  constructor(modelId: string, message: string) {
    super(message, 'INFERENCE_ERROR');
    this.name = 'InferenceError';
    this.modelId = modelId;
  }
}

export class BudgetExceededError extends InferisError {
  readonly requestedMB: number;
  readonly budgetMB: number;

  constructor(requestedMB: number, budgetMB: number) {
    super(
      `Cannot load model: requested ${requestedMB}MB exceeds memory budget ${budgetMB}MB`,
      'BUDGET_EXCEEDED',
    );
    this.name = 'BudgetExceededError';
    this.budgetMB = budgetMB;
    this.requestedMB = requestedMB;
  }
}

export class TaskTimeoutError extends InferisError {
  readonly reqId: string;

  constructor(reqId: string, timeoutMs: number) {
    super(`Task "${reqId}" timed out after ${timeoutMs}ms`, 'TASK_TIMEOUT');
    this.name = 'TaskTimeoutError';
    this.reqId = reqId;
  }
}

export class WorkerError extends InferisError {
  readonly workerId: number;

  constructor(workerId: number, message: string) {
    super(message, 'WORKER_ERROR');
    this.name = 'WorkerError';
    this.workerId = workerId;
  }
}

export class DeviceLostError extends InferisError {
  readonly modelId: string;
  readonly reason: string;

  constructor(modelId: string, reason: string) {
    super(`GPU device lost for model "${modelId}": ${reason}`, 'DEVICE_LOST');
    this.name = 'DeviceLostError';
    this.modelId = modelId;
    this.reason = reason;
  }
}

export class InvalidStateTransitionError extends InferisError {
  constructor(from: string, to: string) {
    super(`Invalid state transition: ${from} -> ${to}`, 'INVALID_STATE_TRANSITION');
    this.name = 'InvalidStateTransitionError';
  }
}

/** Serialize any error for postMessage transmission. */
export function serializeError(err: unknown): SerializedError {
  if (err instanceof InferisError)
    return err.serialize();
  if (err instanceof Error) {
    const base: SerializedError = { code: 'UNKNOWN', message: err.message, name: err.name };
    return err.stack !== undefined ? { ...base, stack: err.stack } : base;
  }
  return { code: 'UNKNOWN', message: String(err), name: 'Error' };
}
