# Cross-Tab Coordination

## Problem

By default, each browser tab runs its own Web Worker and loads models independently. If a user opens your app in 3 tabs and each tab loads a 2GB LLM, they consume 6GB of RAM — likely triggering OOM.

inferis solves this by sharing one worker pool across tabs.

## Enabling Cross-Tab Mode

```typescript
const pool = await createPool({
  adapter: transformersAdapter(),
  crossTab: true,
});
```

That's it. inferis auto-selects the best available tier.

## Three Tiers

### Tier 1: SharedWorker (~58% coverage)

```
Tab 1 ─────────────────┐
Tab 2 ─── MessagePort ──── SharedWorker (one process, one model)
Tab 3 ─────────────────┘
```

One SharedWorker process holds all models. All tabs share the same model memory — opening 5 tabs loads the model once.

**When used:** `typeof SharedWorker !== 'undefined'`
**Coverage:** Chrome 4+, Edge 79+, Firefox 29+, Safari 16+
**NOT available:** iOS Safari < 16, Android Chrome (any version)

### Tier 2: Leader Election (~96% coverage)

```
Tab 1 (leader) ─── Worker ─── Model
Tab 2 (follower) ─── BroadcastChannel → Tab 1 → Worker → Tab 2
Tab 3 (follower) ─── BroadcastChannel → Tab 1 → Worker → Tab 3
```

One tab acquires a Web Lock and becomes the "leader" — it owns the workers. Other tabs proxy requests through `BroadcastChannel`. When the leader tab closes, the lock is released and another tab is automatically promoted.

**When used:** `typeof SharedWorker === 'undefined' && 'locks' in navigator && typeof BroadcastChannel !== 'undefined'`
**Coverage:** Chrome 69+, Firefox 96+, Safari 15.4+, Edge 79+, iOS Safari 15.4+, Android Chrome 69+

### Tier 3: Per-Tab Dedicated Workers (100%)

Each tab gets its own workers. No deduplication. This is the fallback when both SharedWorker and Web Locks are unavailable.

## Memory Savings

| Scenario | Without cross-tab | With cross-tab (tier 1 or 2) |
|----------|------------------|------------------------------|
| 1 tab, 2GB LLM | 2 GB | 2 GB |
| 3 tabs, 2GB LLM | 6 GB | 2 GB |
| 5 tabs, 2GB LLM | 10 GB | 2 GB |

## Limitations

### Mobile Browsers

SharedWorker is not available on iOS Safari < 16 or Android Chrome. Leader election (tier 2) is available on both from iOS 15.4+ / Android Chrome 69+.

### Leader Tab Closing

When the leader tab closes during an ongoing inference:
1. The lock is released
2. A new leader is elected among remaining tabs
3. The new leader starts its own workers
4. Followers that had in-flight requests receive an error — they must retry

This edge case is rare (most users don't close tabs mid-inference). The pool emits `device-lost`-like events that you can handle:

```typescript
const model = await pool.load('text-generation', { model: '...' });

model.onStateChange((state) => {
  if (state === 'error') {
    console.log('Model needs reload — leader tab may have closed');
    // Reload and retry
  }
});
```

### SharedWorker and HTTPS

SharedWorker requires a secure context (HTTPS or localhost). On plain HTTP, it falls back to tier 2 or 3.

### Debugging

The elected tier is exposed on the pool:

```typescript
const caps = pool.capabilities();
console.log('SharedWorker available:', caps.sharedWorker);
console.log('Web Locks available:', caps.webLocks);
console.log('BroadcastChannel available:', caps.broadcastChannel);
```
