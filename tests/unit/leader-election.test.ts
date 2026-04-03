import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LeaderElection } from '../../src/coordination/leader-election.js';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function makeLocksMock(opts: {
  heldNames?: string[];
  pendingNames?: string[];
  requestReject?: Error;
} = {}) {
  const shouldGrant = !(opts.heldNames?.length) && !(opts.pendingNames?.length);

  return {
    query: async () => ({
      held: (opts.heldNames ?? []).map(name => ({ name })),
      pending: (opts.pendingNames ?? []).map(name => ({ name })),
    }),
    request: vi.fn((_name: string, lockOpts: { signal: AbortSignal }, cb: () => Promise<void>): Promise<void> => {
      if (opts.requestReject)
        return Promise.reject(opts.requestReject);
      if (!shouldGrant) {
        return new Promise<void>((_res, rej) => {
          lockOpts.signal.addEventListener('abort', () => {
            rej(Object.assign(new Error('AbortError'), { name: 'AbortError' }));
          });
        });
      }
      return cb();
    }),
  };
}

describe('leaderElection', () => {
  describe('isSupported', () => {
    it('returns false when navigator is absent', () => {
      vi.stubGlobal('navigator', undefined);
      expect(LeaderElection.isSupported()).toBe(false);
    });

    it('returns false when navigator.locks is absent', () => {
      vi.stubGlobal('navigator', {});
      expect(LeaderElection.isSupported()).toBe(false);
    });

    it('returns true when navigator.locks is present', () => {
      vi.stubGlobal('navigator', { locks: {} });
      expect(LeaderElection.isSupported()).toBe(true);
    });
  });

  describe('start() when locks not supported', () => {
    it('immediately becomes leader', async () => {
      vi.stubGlobal('navigator', undefined);
      const le = new LeaderElection();
      const role = await le.start();
      expect(role).toBe('leader');
      expect(le.isLeader).toBe(true);
      expect(le.currentRole).toBe('leader');
    });
  });

  describe('start() when lock is immediately available', () => {
    it('becomes leader', async () => {
      const locks = makeLocksMock({ heldNames: [], pendingNames: [] });
      vi.stubGlobal('navigator', { locks });

      const le = new LeaderElection();
      const rolePromise = le.start();
      await vi.runAllTimersAsync();
      const role = await rolePromise;
      expect(role).toBe('leader');
    });
  });

  describe('start() when lock is already held', () => {
    it('becomes follower', async () => {
      const locks = makeLocksMock({ heldNames: ['inferis:leader'] });
      vi.stubGlobal('navigator', { locks });

      const le = new LeaderElection();
      const rolePromise = le.start();
      await vi.runAllTimersAsync();
      const role = await rolePromise;
      expect(role).toBe('follower');
      expect(le.isLeader).toBe(false);
    });
  });

  describe('start() when lock is pending', () => {
    it('becomes follower', async () => {
      const locks = makeLocksMock({ pendingNames: ['inferis:leader'] });
      vi.stubGlobal('navigator', { locks });

      const le = new LeaderElection();
      const rolePromise = le.start();
      await vi.runAllTimersAsync();
      const role = await rolePromise;
      expect(role).toBe('follower');
    });
  });

  describe('timeout fallback', () => {
    it('becomes leader after 5s timeout', async () => {
      const neverResolve = {
        query: () => new Promise(() => {}),
        request: () => new Promise(() => {}),
      };
      vi.stubGlobal('navigator', { locks: neverResolve });

      const le = new LeaderElection();
      const rolePromise = le.start();
      vi.advanceTimersByTime(5000);
      const role = await rolePromise;
      expect(role).toBe('leader');
    });
  });

  describe('stop()', () => {
    it('can be called without start', () => {
      const le = new LeaderElection();
      expect(() => le.stop()).not.toThrow();
    });

    it('aborts after start', async () => {
      const locks = makeLocksMock({ heldNames: [], pendingNames: [] });
      vi.stubGlobal('navigator', { locks });

      const le = new LeaderElection();
      const rolePromise = le.start();
      le.stop();
      await vi.runAllTimersAsync();
      await rolePromise.catch(() => {});
    });
  });

  describe('onRoleChange', () => {
    it('notifies callback on role change', async () => {
      vi.stubGlobal('navigator', undefined);
      const le = new LeaderElection();
      const cb = vi.fn();
      le.onRoleChange(cb);
      await le.start();
      expect(cb).toHaveBeenCalledWith('leader');
    });

    it('unsubscribe removes callback', async () => {
      vi.stubGlobal('navigator', undefined);
      const le = new LeaderElection();
      const cb = vi.fn();
      const off = le.onRoleChange(cb);
      off();
      await le.start();
      expect(cb).not.toHaveBeenCalled();
    });

    it('swallows throwing callbacks', async () => {
      vi.stubGlobal('navigator', undefined);
      const le = new LeaderElection();
      le.onRoleChange(() => {
        throw new Error('boom');
      });
      await expect(le.start()).resolves.toBe('leader');
    });
  });

  describe('currentRole / isLeader', () => {
    it('initial role is unknown', () => {
      const le = new LeaderElection();
      expect(le.currentRole).toBe('unknown');
      expect(le.isLeader).toBe(false);
    });
  });

  describe('request() abort error handling', () => {
    it('ignores AbortError from locks.request', async () => {
      const abortError = Object.assign(new Error('abort'), { name: 'AbortError' });
      const locks = makeLocksMock({ requestReject: abortError });
      vi.stubGlobal('navigator', { locks });

      const le = new LeaderElection();
      const rolePromise = le.start();
      await vi.runAllTimersAsync();
      const role = await rolePromise;
      expect(['leader', 'follower']).toContain(role);
    });
  });

  describe('instance isSupported()', () => {
    it('matches static method', () => {
      vi.stubGlobal('navigator', { locks: {} });
      const le = new LeaderElection();
      expect(le.isSupported()).toBe(LeaderElection.isSupported());
    });
  });
});
