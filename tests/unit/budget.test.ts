import { describe, expect, it } from 'vitest';
import { MemoryBudget } from '../../src/core/budget.js';

describe('memoryBudget', () => {
  it('initializes with correct values', () => {
    const b = new MemoryBudget(1024);
    expect(b.totalMB).toBe(1024);
    expect(b.allocatedMB).toBe(0);
    expect(b.availableMB).toBe(1024);
  });

  it('throws for non-positive maxMB', () => {
    expect(() => new MemoryBudget(0)).toThrow(RangeError);
    expect(() => new MemoryBudget(-1)).toThrow(RangeError);
  });

  describe('allocate / release', () => {
    it('tracks allocated memory', () => {
      const b = new MemoryBudget(1024);
      b.allocate('m1', 200);
      expect(b.allocatedMB).toBe(200);
      expect(b.availableMB).toBe(824);
    });

    it('releases memory correctly', () => {
      const b = new MemoryBudget(1024);
      b.allocate('m1', 200);
      b.release('m1');
      expect(b.allocatedMB).toBe(0);
      expect(b.availableMB).toBe(1024);
    });

    it('no-ops release for unknown model', () => {
      const b = new MemoryBudget(1024);
      expect(() => b.release('unknown')).not.toThrow();
    });

    it('re-allocate replaces previous size', () => {
      const b = new MemoryBudget(1024);
      b.allocate('m1', 200);
      b.allocate('m1', 100);
      expect(b.allocatedMB).toBe(100);
    });
  });

  describe('fits', () => {
    it('returns true when request fits without eviction', () => {
      const b = new MemoryBudget(1024);
      b.allocate('m1', 500);
      expect(b.fits(400)).toBe(true);
      expect(b.fits(524)).toBe(true);
      expect(b.fits(525)).toBe(false);
    });
  });

  describe('planEviction', () => {
    it('returns empty array when no eviction needed', () => {
      const b = new MemoryBudget(1024);
      b.allocate('m1', 200);
      expect(b.planEviction(100)).toEqual([]);
    });

    it('returns null when required > total budget', () => {
      const b = new MemoryBudget(1024);
      expect(b.planEviction(2000)).toBeNull();
    });

    it('returns LRU-ordered eviction candidates', () => {
      const b = new MemoryBudget(1024);
      b.allocate('m1', 300);
      b.allocate('m2', 300);
      b.allocate('m3', 300);

      // m1 is LRU (oldest), need 200MB free (currently have 124)
      const evict = b.planEviction(300);
      expect(evict).toEqual(['m1']);
    });

    it('evicts multiple models if needed', () => {
      const b = new MemoryBudget(1024);
      b.allocate('m1', 300);
      b.allocate('m2', 300);
      b.allocate('m3', 300);

      // need 600MB, have 124, must evict m1+m2
      const evict = b.planEviction(600);
      expect(evict).toEqual(['m1', 'm2']);
    });

    it('returns null when requiredMB exceeds total budget', () => {
      const b = new MemoryBudget(1024);
      b.allocate('m1', 300);
      b.allocate('m2', 300);

      // 1025 > total budget 1024 -> impossible regardless of evictions
      expect(b.planEviction(1025)).toBeNull();
    });
  });

  describe('touch / LRU ordering', () => {
    it('touch moves model to end of LRU queue', () => {
      const b = new MemoryBudget(1024);
      b.allocate('m1', 100);
      b.allocate('m2', 100);
      b.allocate('m3', 100);

      // LRU order: m1, m2, m3
      expect(b.lruList[0]).toBe('m1');

      b.touch('m1');
      // LRU order: m2, m3, m1
      expect(b.lruList[0]).toBe('m2');
      expect(b.lruList[2]).toBe('m1');
    });

    it('eviction respects touch order', () => {
      const b = new MemoryBudget(1024);
      b.allocate('m1', 300);
      b.allocate('m2', 300);
      b.allocate('m3', 300);

      b.touch('m1'); // m1 is now MRU; LRU: m2, m3, m1

      const evict = b.planEviction(300);
      expect(evict).toEqual(['m2']);
    });
  });
});
