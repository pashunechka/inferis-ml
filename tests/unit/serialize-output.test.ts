import { describe, expect, it } from 'vitest';
import { serializeOutput } from '../../src/adapters/transformers.js';

describe('serializeOutput', () => {
  describe('primitives passthrough', () => {
    it('returns null unchanged', () => {
      expect(serializeOutput(null)).toBeNull();
    });

    it('returns undefined unchanged', () => {
      expect(serializeOutput(undefined)).toBeUndefined();
    });

    it('returns string unchanged', () => {
      expect(serializeOutput('hello')).toBe('hello');
    });

    it('returns number unchanged', () => {
      expect(serializeOutput(42)).toBe(42);
    });

    it('returns boolean unchanged', () => {
      expect(serializeOutput(true)).toBe(true);
    });
  });

  describe('plain objects', () => {
    it('passes through simple object', () => {
      expect(serializeOutput({ foo: 'bar' })).toEqual({ foo: 'bar' });
    });

    it('recursively processes nested objects', () => {
      const input = { a: { b: { c: 'deep' } } };
      expect(serializeOutput(input)).toEqual({ a: { b: { c: 'deep' } } });
    });
  });

  describe('arrays', () => {
    it('maps over array elements', () => {
      expect(serializeOutput([1, 'two', null])).toEqual([1, 'two', null]);
    });

    it('processes nested arrays', () => {
      expect(serializeOutput([[1, 2], [3, 4]])).toEqual([[1, 2], [3, 4]]);
    });
  });

  describe('tensor-like objects', () => {
    it('converts Float32Array data to plain Array', () => {
      const tensor = {
        data: Float32Array.from([1.0, 2.0, 3.0]),
        dims: [1, 3],
        size: 3,
        type: 'float32',
      };
      expect(serializeOutput(tensor)).toEqual({
        data: [1.0, 2.0, 3.0],
        dims: [1, 3],
        size: 3,
        type: 'float32',
      });
    });

    it('converts Int32Array data to plain Array', () => {
      const tensor = {
        data: Int32Array.from([10, 20, 30]),
        dims: [3],
        size: 3,
        type: 'int32',
      };
      const result = serializeOutput(tensor) as Record<string, unknown>;
      expect(Array.isArray(result.data)).toBe(true);
      expect(result.data).toEqual([10, 20, 30]);
    });

    it('converts Uint8Array data to plain Array', () => {
      const tensor = {
        data: Uint8Array.from([255, 0, 128]),
        dims: [3],
        size: 3,
        type: 'uint8',
      };
      const result = serializeOutput(tensor) as Record<string, unknown>;
      expect(Array.isArray(result.data)).toBe(true);
      expect(result.data).toEqual([255, 0, 128]);
    });

    it('converts Float64Array data to plain Array', () => {
      const tensor = {
        data: Float64Array.from([1.1, 2.2]),
        dims: [2],
        size: 2,
        type: 'float64',
      };
      const result = serializeOutput(tensor) as Record<string, unknown>;
      expect(Array.isArray(result.data)).toBe(true);
      expect(result.data).toEqual([1.1, 2.2]);
    });

    it('handles empty Tensor', () => {
      const tensor = {
        data: Float32Array.from([]),
        dims: [0],
        size: 0,
        type: 'float32',
      };
      expect(serializeOutput(tensor)).toEqual({
        data: [],
        dims: [0],
        size: 0,
        type: 'float32',
      });
    });

    it('converts plain Array data in Tensor-like object', () => {
      const tensor = {
        data: [1, 2, 3],
        dims: [3],
        size: 3,
        type: 'float32',
      };
      const result = serializeOutput(tensor) as Record<string, unknown>;
      expect(result.data).toEqual([1, 2, 3]);
    });
  });

  describe('nested Tensors', () => {
    it('converts Tensor nested inside object', () => {
      const input = {
        embedding: {
          data: Float32Array.from([0.1, 0.2]),
          dims: [1, 2],
          size: 2,
          type: 'float32',
        },
        label: 'test',
      };
      const result = serializeOutput(input) as Record<string, unknown>;
      expect(result.label).toBe('test');
      expect(result.embedding).toEqual({
        data: [expect.closeTo(0.1), expect.closeTo(0.2)],
        dims: [1, 2],
        size: 2,
        type: 'float32',
      });
    });

    it('converts array of Tensors', () => {
      const input = [
        { data: Float32Array.from([1]), dims: [1], size: 1, type: 'float32' },
        { data: Float32Array.from([2]), dims: [1], size: 1, type: 'float32' },
      ];
      const result = serializeOutput(input) as Array<Record<string, unknown>>;
      expect(result).toHaveLength(2);
      expect(Array.isArray(result[0].data)).toBe(true);
      expect(Array.isArray(result[1].data)).toBe(true);
    });

    it('handles mixed nested structure with Tensors at different depths', () => {
      const input = {
        outputs: [
          {
            scores: { data: Float32Array.from([0.9, 0.1]), dims: [2], size: 2, type: 'float32' },
            label: 'positive',
          },
        ],
        metadata: { count: 1 },
      };
      const result = serializeOutput(input) as Record<string, unknown>;
      const outputs = result.outputs as Array<Record<string, unknown>>;
      expect(outputs[0].label).toBe('positive');
      const scores = outputs[0].scores as Record<string, unknown>;
      expect(Array.isArray(scores.data)).toBe(true);
      expect(scores.dims).toEqual([2]);
    });
  });

  describe('edge cases', () => {
    it('does NOT treat object with data but non-array dims as Tensor', () => {
      const input = { data: [1, 2], dims: 'not-array', other: 'field' };
      const result = serializeOutput(input) as Record<string, unknown>;
      expect(result.data).toEqual([1, 2]);
      expect(result.dims).toBe('not-array');
      expect(result.other).toBe('field');
    });

    it('does NOT treat object with dims but no data as Tensor', () => {
      const input = { dims: [3], label: 'test' };
      const result = serializeOutput(input) as Record<string, unknown>;
      expect(result.dims).toEqual([3]);
      expect(result.label).toBe('test');
    });
  });

  describe('properties', () => {
    it('output is structuredClone-safe', () => {
      const tensor = {
        data: Float32Array.from([1.0, 2.0]),
        dims: [2],
        size: 2,
        type: 'float32',
      };
      const serialized = serializeOutput(tensor);
      expect(() => structuredClone(serialized)).not.toThrow();
    });

    it('is idempotent — double serialization produces same result', () => {
      const tensor = {
        data: Float32Array.from([1.0, 2.0, 3.0]),
        dims: [1, 3],
        size: 3,
        type: 'float32',
      };
      const first = serializeOutput(tensor);
      const second = serializeOutput(first);
      expect(second).toEqual(first);
    });

    it('complex nested output is structuredClone-safe', () => {
      const input = {
        embeddings: [
          { data: Float32Array.from([0.5, 0.3]), dims: [2], size: 2, type: 'float32' },
        ],
        labels: ['a', 'b'],
        nested: { tensor: { data: Int32Array.from([1]), dims: [1], size: 1, type: 'int32' } },
      };
      const serialized = serializeOutput(input);
      expect(() => structuredClone(serialized)).not.toThrow();
    });
  });
});
