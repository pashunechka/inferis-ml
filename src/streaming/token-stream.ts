/**
 * Async iterator adapter for ReadableStream.
 *
 * Allows `for await (const token of stream)` syntax when the runtime
 * does not natively support ReadableStream async iteration.
 *
 * @example
 * ```ts
 * const stream = model.stream({ messages: [...] });
 * for await (const token of readableToAsyncIter(stream)) {
 *   process.stdout.write(token);
 * }
 * ```
 */
export function readableToAsyncIter<T>(stream: ReadableStream<T>): AsyncIterable<T> {
  if (Symbol.asyncIterator in stream) {
    return stream as unknown as AsyncIterable<T>;
  }

  return {
    [Symbol.asyncIterator](): AsyncIterator<T> {
      const reader = stream.getReader();
      return {
        async next() {
          const { done, value } = await reader.read();
          if (done)
            return { done: true, value: undefined as unknown as T };
          return { done: false, value };
        },
        async return() {
          await reader.cancel();
          return { done: true, value: undefined as unknown as T };
        },
        async throw(err) {
          await reader.cancel(err);
          throw err;
        },
      };
    },
  };
}

/**
 * Collect all chunks from a ReadableStream into an array.
 * Useful for non-streaming consumers.
 */
export async function collectStream<T>(stream: ReadableStream<T>): Promise<T[]> {
  const results: T[] = [];
  for await (const chunk of readableToAsyncIter(stream)) {
    results.push(chunk);
  }
  return results;
}

/**
 * Collect all chunks from a ReadableStream and join them as a string.
 */
export async function collectStreamText(stream: ReadableStream<string>): Promise<string> {
  const chunks = await collectStream(stream);
  return chunks.join('');
}
