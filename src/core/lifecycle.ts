import type { ModelState } from './types.js';
import { InvalidStateTransitionError } from './errors.js';

/** Valid transitions: from -> Set<to> */
const TRANSITIONS: Readonly<Record<ModelState, ReadonlySet<ModelState>>> = {
  disposed: new Set<ModelState>(),
  error: new Set<ModelState>(['loading', 'disposed']),
  idle: new Set<ModelState>(['loading', 'disposed']),
  inferring: new Set<ModelState>(['inferring', 'ready', 'error', 'unloading']),
  loading: new Set<ModelState>(['ready', 'error', 'disposed']),
  ready: new Set<ModelState>(['inferring', 'unloading', 'error']),
  unloading: new Set<ModelState>(['disposed']),
};

/**
 * Validate and apply a lifecycle state transition.
 *
 * @throws {InvalidStateTransitionError} if the transition is not allowed.
 */
export function transition(from: ModelState, to: ModelState): ModelState {
  if (!TRANSITIONS[from].has(to)) {
    throw new InvalidStateTransitionError(from, to);
  }
  return to;
}

/**
 * Check if a state transition is valid without throwing.
 */
export function canTransition(from: ModelState, to: ModelState): boolean {
  return TRANSITIONS[from].has(to);
}

/**
 * Check if a model in the given state can accept inference tasks.
 */
export function isAcceptingInference(state: ModelState): boolean {
  return state === 'ready';
}

/**
 * Check if a model in the given state is considered terminal (no further transitions possible).
 */
export function isTerminal(state: ModelState): boolean {
  return state === 'disposed';
}
