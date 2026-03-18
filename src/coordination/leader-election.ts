const LOCK_NAME = 'inferis:leader';

type RoleChangeCallback = (role: 'leader' | 'follower') => void;

/**
 * Leader election via Web Locks API.
 *
 * @remarks
 * One tab holds the lock and acts as the "leader" — it owns the worker pool.
 * All other tabs are "followers" and proxy their requests through BroadcastChannel.
 *
 * When the leader tab closes, the lock is released automatically by the browser,
 * and the next tab in the lock queue is promoted to leader.
 *
 * Web Locks + BroadcastChannel combined coverage: ~96% of modern browsers.
 *
 * iOS Safari and older Android Chrome do not support SharedWorker but DO support
 * Web Locks, making this tier 2 a reliable cross-mobile fallback.
 */
export class LeaderElection {
  private role: 'leader' | 'follower' | 'unknown' = 'unknown';
  private readonly listeners = new Set<RoleChangeCallback>();
  private abortController: AbortController | null = null;

  /**
   * Start leader election. Resolves once the role is determined.
   * The lock is held for the lifetime of the tab.
   */
  async start(): Promise<'leader' | 'follower'> {
    if (!this.isSupported()) {
      this.setRole('leader');
      return 'leader';
    }

    this.abortController = new AbortController();
    let resolved = false;

    return new Promise<'leader' | 'follower'>((resolve) => {
      const timeout = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          this.setRole('leader');
          resolve('leader');
        }
      }, 5000);

      navigator.locks.request(
        LOCK_NAME,
        { signal: this.abortController!.signal },
        async () => {
          if (!resolved) {
            resolved = true;
            clearTimeout(timeout);
            this.setRole('leader');
            resolve('leader');
          }
          await this.holdLock();
        },
      ).catch((err: Error) => {
        if (err.name !== 'AbortError') {
          void err;
        }
      });

      navigator.locks.query().then((state) => {
        if (resolved)
          return;
        const held = state.held?.some(l => l.name === LOCK_NAME) ?? false;
        const pending = state.pending?.some(l => l.name === LOCK_NAME) ?? false;
        if (held || pending) {
          resolved = true;
          clearTimeout(timeout);
          this.setRole('follower');
          resolve('follower');
        }
      }).catch(() => {
        // locks.query() may not be available
      });
    });
  }

  private holdLock(): Promise<void> {
    return new Promise<void>((resolve) => {
      if (this.abortController) {
        this.abortController.signal.addEventListener('abort', () => resolve(), { once: true });
      }
    });
  }

  /**
   * Release the lock and stop the election. Used for cleanup.
   */
  stop(): void {
    this.abortController?.abort();
    this.abortController = null;
  }

  /**
   * Subscribe to role changes.
   * @returns unsubscribe function
   */
  onRoleChange(callback: RoleChangeCallback): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  get currentRole(): 'leader' | 'follower' | 'unknown' {
    return this.role;
  }

  get isLeader(): boolean {
    return this.role === 'leader';
  }

  private setRole(role: 'leader' | 'follower'): void {
    this.role = role;
    for (const listener of this.listeners) {
      try {
        listener(role);
      }
      catch { /* noop */ }
    }
  }

  /**
   * Check if the Web Locks API is available.
   */
  static isSupported(): boolean {
    return typeof navigator !== 'undefined' && 'locks' in navigator;
  }

  isSupported(): boolean {
    return LeaderElection.isSupported();
  }
}
