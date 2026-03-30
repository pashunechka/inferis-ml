import { describe, expect, it, vi } from 'vitest';
import { ModelRegistry } from '../../src/core/registry.js';

describe('modelRegistry', () => {
  describe('makeId', () => {
    it('composes task:model', () => {
      expect(ModelRegistry.makeId('feature-extraction', 'bert-base')).toBe('feature-extraction:bert-base');
    });
  });

  describe('register', () => {
    it('creates a new entry with idle state', () => {
      const r = new ModelRegistry();
      const entry = r.register('t:m', 'text', { model: 'm' });
      expect(entry.id).toBe('t:m');
      expect(entry.task).toBe('text');
      expect(entry.state).toBe('idle');
      expect(entry.memoryMB).toBe(0);
      expect(entry.workerId).toBeNull();
      expect(entry.device).toBe('wasm');
    });

    it('returns existing entry if already registered', () => {
      const r = new ModelRegistry();
      const e1 = r.register('t:m', 'text', { model: 'm' });
      const e2 = r.register('t:m', 'text', { model: 'm' });
      expect(e1).toBe(e2);
    });
  });

  describe('get / has', () => {
    it('returns undefined for unknown id', () => {
      const r = new ModelRegistry();
      expect(r.get('unknown')).toBeUndefined();
    });

    it('has returns false for unknown', () => {
      const r = new ModelRegistry();
      expect(r.has('x')).toBe(false);
    });

    it('has returns true for registered', () => {
      const r = new ModelRegistry();
      r.register('t:m', 'text', {});
      expect(r.has('t:m')).toBe(true);
    });

    it('get returns registered entry', () => {
      const r = new ModelRegistry();
      r.register('t:m', 'text', {});
      expect(r.get('t:m')).toBeDefined();
    });
  });

  describe('setState', () => {
    it('updates state', () => {
      const r = new ModelRegistry();
      r.register('t:m', 'text', {});
      r.setState('t:m', 'loading');
      expect(r.get('t:m')!.state).toBe('loading');
    });

    it('no-ops for unknown id', () => {
      const r = new ModelRegistry();
      expect(() => r.setState('unknown', 'loading')).not.toThrow();
    });

    it('notifies listeners', () => {
      const r = new ModelRegistry();
      r.register('t:m', 'text', {});
      const cb = vi.fn();
      r.subscribe('t:m', cb);
      r.setState('t:m', 'loading');
      expect(cb).toHaveBeenCalledWith('loading');
    });

    it('swallows throwing listeners', () => {
      const r = new ModelRegistry();
      r.register('t:m', 'text', {});
      r.subscribe('t:m', () => {
        throw new Error('bang');
      });
      expect(() => r.setState('t:m', 'loading')).not.toThrow();
    });
  });

  describe('setLoaded', () => {
    it('updates device, memoryMB, workerId', () => {
      const r = new ModelRegistry();
      r.register('t:m', 'text', {});
      r.setLoaded('t:m', 'webgpu', 256, 3);
      const e = r.get('t:m')!;
      expect(e.device).toBe('webgpu');
      expect(e.memoryMB).toBe(256);
      expect(e.workerId).toBe(3);
    });

    it('no-ops for unknown id', () => {
      const r = new ModelRegistry();
      expect(() => r.setLoaded('unknown', 'wasm', 0, 0)).not.toThrow();
    });
  });

  describe('setUnloaded', () => {
    it('clears workerId and memoryMB', () => {
      const r = new ModelRegistry();
      r.register('t:m', 'text', {});
      r.setLoaded('t:m', 'webgpu', 256, 3);
      r.setUnloaded('t:m');
      const e = r.get('t:m')!;
      expect(e.workerId).toBeNull();
      expect(e.memoryMB).toBe(0);
    });

    it('no-ops for unknown id', () => {
      const r = new ModelRegistry();
      expect(() => r.setUnloaded('unknown')).not.toThrow();
    });
  });

  describe('subscribe', () => {
    it('unsubscribe removes listener', () => {
      const r = new ModelRegistry();
      r.register('t:m', 'text', {});
      const cb = vi.fn();
      const unsub = r.subscribe('t:m', cb);
      unsub();
      r.setState('t:m', 'loading');
      expect(cb).not.toHaveBeenCalled();
    });

    it('returns noop for unknown model', () => {
      const r = new ModelRegistry();
      const unsub = r.subscribe('unknown', vi.fn());
      expect(() => unsub()).not.toThrow();
    });
  });

  describe('delete', () => {
    it('removes entry and clears listeners', () => {
      const r = new ModelRegistry();
      r.register('t:m', 'text', {});
      const cb = vi.fn();
      r.subscribe('t:m', cb);
      r.delete('t:m');
      expect(r.has('t:m')).toBe(false);
      expect(r.size).toBe(0);
    });

    it('no-ops for unknown id', () => {
      const r = new ModelRegistry();
      expect(() => r.delete('unknown')).not.toThrow();
    });
  });

  describe('byState', () => {
    it('returns entries matching state', () => {
      const r = new ModelRegistry();
      r.register('t:a', 'text', {});
      r.register('t:b', 'text', {});
      r.setState('t:a', 'loading');
      expect(r.byState('loading').length).toBe(1);
      expect(r.byState('loading')[0]!.id).toBe('t:a');
      expect(r.byState('idle').length).toBe(1);
    });
  });

  describe('byWorker', () => {
    it('returns entries assigned to worker', () => {
      const r = new ModelRegistry();
      r.register('t:a', 'text', {});
      r.register('t:b', 'text', {});
      r.setLoaded('t:a', 'wasm', 100, 1);
      r.setLoaded('t:b', 'wasm', 100, 2);
      expect(r.byWorker(1).length).toBe(1);
      expect(r.byWorker(1)[0]!.id).toBe('t:a');
    });
  });

  describe('size / entries', () => {
    it('size reflects registered count', () => {
      const r = new ModelRegistry();
      expect(r.size).toBe(0);
      r.register('t:a', 'text', {});
      expect(r.size).toBe(1);
    });

    it('entries returns readonly map', () => {
      const r = new ModelRegistry();
      r.register('t:a', 'text', {});
      expect(r.entries.size).toBe(1);
      expect(r.entries.get('t:a')).toBeDefined();
    });
  });
});
