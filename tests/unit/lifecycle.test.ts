import type { ModelState } from '../../src/core/types.js';
import { describe, expect, it } from 'vitest';
import { InvalidStateTransitionError } from '../../src/core/errors.js';
import { canTransition, isAcceptingInference, isTerminal, transition } from '../../src/core/lifecycle.js';

describe('transition', () => {
  it('applies valid transitions', () => {
    expect(transition('idle', 'loading')).toBe('loading');
    expect(transition('loading', 'ready')).toBe('ready');
    expect(transition('ready', 'inferring')).toBe('inferring');
    expect(transition('inferring', 'ready')).toBe('ready');
    expect(transition('ready', 'unloading')).toBe('unloading');
    expect(transition('unloading', 'disposed')).toBe('disposed');
    expect(transition('loading', 'error')).toBe('error');
    expect(transition('error', 'loading')).toBe('loading');
    expect(transition('error', 'disposed')).toBe('disposed');
  });

  it('throws InvalidStateTransitionError for invalid transitions', () => {
    expect(() => transition('disposed', 'ready')).toThrow(InvalidStateTransitionError);
    expect(() => transition('ready', 'idle')).toThrow(InvalidStateTransitionError);
    expect(() => transition('idle', 'ready')).toThrow(InvalidStateTransitionError);
    expect(() => transition('inferring', 'loading')).toThrow(InvalidStateTransitionError);
  });

  it('includes from/to states in error message', () => {
    try {
      transition('disposed', 'ready');
    }
    catch (e) {
      expect((e as Error).message).toContain('disposed');
      expect((e as Error).message).toContain('ready');
    }
  });
});

describe('canTransition', () => {
  it('returns true for valid transitions', () => {
    expect(canTransition('idle', 'loading')).toBe(true);
    expect(canTransition('ready', 'inferring')).toBe(true);
    expect(canTransition('error', 'disposed')).toBe(true);
  });

  it('returns false for invalid transitions', () => {
    expect(canTransition('disposed', 'ready')).toBe(false);
    expect(canTransition('ready', 'idle')).toBe(false);
    expect(canTransition('inferring', 'loading')).toBe(false);
  });
});

describe('isAcceptingInference', () => {
  const accepting: ModelState[] = ['ready'];
  const notAccepting: ModelState[] = ['idle', 'loading', 'inferring', 'unloading', 'error', 'disposed'];

  it.each(accepting)('returns true for %s', (state) => {
    expect(isAcceptingInference(state)).toBe(true);
  });

  it.each(notAccepting)('returns false for %s', (state) => {
    expect(isAcceptingInference(state)).toBe(false);
  });
});

describe('isTerminal', () => {
  it('returns true only for disposed', () => {
    expect(isTerminal('disposed')).toBe(true);
    expect(isTerminal('error')).toBe(false);
    expect(isTerminal('ready')).toBe(false);
  });
});
