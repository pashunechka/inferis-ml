const CHANNEL_NAME = 'inferis:bus';

const KNOWN_MESSAGE_TYPES = new Set([
  'leader-elected',
  'leader-gone',
  'request',
  'response',
  'stream-chunk',
  'stream-end',
  'stream-error',
]);

export type TabChannelMessage
  = | { type: 'leader-elected'; tabId: string }
    | { type: 'leader-gone'; tabId: string }
    | { type: 'request'; tabId: string; reqId: string; payload: unknown }
    | { type: 'response'; reqId: string; payload: unknown; error?: { message: string; name: string } }
    | { type: 'stream-chunk'; reqId: string; chunk: unknown }
    | { type: 'stream-end'; reqId: string }
    | { type: 'stream-error'; reqId: string; error: { message: string; name: string } };

type TabChannelListener = (msg: TabChannelMessage) => void;

function isValidMessage(data: unknown): data is TabChannelMessage {
  return (
    typeof data === 'object'
    && data !== null
    && 'type' in data
    && typeof (data as Record<string, unknown>).type === 'string'
    && KNOWN_MESSAGE_TYPES.has((data as Record<string, unknown>).type as string)
  );
}

/**
 * Thin wrapper over BroadcastChannel for cross-tab coordination.
 *
 * @remarks
 * BroadcastChannel has ~96% browser coverage and works on both desktop
 * and mobile. Messages are NOT delivered to the sender tab.
 */
export class TabChannel {
  private readonly channel: BroadcastChannel;
  private readonly listeners = new Set<TabChannelListener>();

  constructor() {
    this.channel = new BroadcastChannel(CHANNEL_NAME);
    this.channel.onmessage = (event: MessageEvent) => {
      if (!isValidMessage(event.data))
        return;
      for (const listener of this.listeners) {
        try {
          listener(event.data);
        }
        catch {
          // listeners must not throw
        }
      }
    };
  }

  /**
   * Broadcast a message to all other tabs.
   */
  send(msg: TabChannelMessage): void {
    this.channel.postMessage(msg);
  }

  /**
   * Subscribe to incoming messages.
   * @returns unsubscribe function
   */
  on(listener: TabChannelListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Close the channel and remove all listeners.
   */
  close(): void {
    this.listeners.clear();
    this.channel.close();
  }

  /**
   * Check if BroadcastChannel is available in the current environment.
   */
  static isSupported(): boolean {
    return typeof BroadcastChannel !== 'undefined';
  }
}
