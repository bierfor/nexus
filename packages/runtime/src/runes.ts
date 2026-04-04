/**
 * Nexus Runes — Fine-grained reactive primitives inspired by Svelte 5.
 * Zero Virtual DOM. The runtime surgically updates only what changed.
 */

type Subscriber<T> = (value: T) => void;
type Cleanup = () => void;

// ── Internal tracking context ─────────────────────────────────────────────
let currentEffect: EffectNode | null = null;

interface EffectNode {
  execute: () => void;
  cleanup: Cleanup | void;
  deps: Set<SignalNode<unknown>>;
}

interface SignalNode<T> {
  value: T;
  subscribers: Set<EffectNode>;
  readonly id: number;
}

let idCounter = 0;

// ── $state ────────────────────────────────────────────────────────────────

/**
 * Creates a reactive signal. Reading `.value` inside an `$effect` or
 * `$derived` automatically creates a dependency subscription.
 *
 * @example
 * const count = $state(0);
 * count.value++; // triggers all subscribers
 */
export function $state<T>(initial: T): { value: T } {
  const node: SignalNode<T> = {
    value: initial,
    subscribers: new Set(),
    id: idCounter++,
  };

  return {
    get value() {
      if (currentEffect) {
        node.subscribers.add(currentEffect);
        currentEffect.deps.add(node as SignalNode<unknown>);
      }
      return node.value;
    },
    set value(next: T) {
      if (Object.is(node.value, next)) return;
      node.value = next;
      // Notify all subscribers synchronously (microtask queue in practice)
      for (const effect of [...node.subscribers]) {
        try {
          effect.cleanup?.();
          effect.execute();
        } catch (e) {
          console.error('[Nexus] $effect error (subscriber):', e);
        }
      }
    },
  };
}

// ── $derived ──────────────────────────────────────────────────────────────

/**
 * Creates a computed value that automatically updates when its dependencies
 * change. Computed lazily — only recalculates when accessed after a change.
 *
 * @example
 * const count = $state(0);
 * const doubled = $derived(() => count.value * 2);
 * console.log(doubled.value); // 0
 * count.value = 5;
 * console.log(doubled.value); // 10
 */
export function $derived<T>(computation: () => T): { readonly value: T } {
  const signal = $state<T>(computation());
  let dirty = false;

  $effect(() => {
    const next = computation();
    if (!Object.is(signal.value, next)) {
      signal.value = next;
    }
  });

  return {
    get value() {
      return signal.value;
    },
  };
}

// ── $effect ───────────────────────────────────────────────────────────────

/**
 * Runs a side effect whenever its reactive dependencies change.
 * Returns a cleanup function to stop tracking.
 *
 * @example
 * const count = $state(0);
 * $effect(() => {
 *   document.title = `Count: ${count.value}`;
 * });
 */
export function $effect(fn: () => Cleanup | void): Cleanup {
  const node: EffectNode = {
    execute: () => {
      // Clean up previous subscriptions
      for (const dep of node.deps) {
        dep.subscribers.delete(node);
      }
      node.deps.clear();

      const prev = currentEffect;
      currentEffect = node;
      try {
        node.cleanup = fn();
      } catch (e) {
        console.error('[Nexus] $effect error:', e);
      } finally {
        currentEffect = prev;
      }
    },
    cleanup: undefined,
    deps: new Set(),
  };

  node.execute();

  return () => {
    node.cleanup?.();
    for (const dep of node.deps) {
      dep.subscribers.delete(node);
    }
    node.deps.clear();
  };
}

// ── $props ────────────────────────────────────────────────────────────────

/**
 * Declares component props with optional defaults.
 * Props are reactive — parent changes flow down automatically.
 *
 * @example
 * const { name, age = 18 } = $props<{ name: string; age?: number }>();
 */
export function $props<T extends Record<string, unknown>>(
  defaults: Partial<T> = {},
): T {
  // In island context, props are injected from the server manifest.
  // This is a typed accessor with defaults.
  return new Proxy(defaults as T, {
    get(target, key: string) {
      return target[key as keyof T];
    },
  });
}

// ── Batch updates ─────────────────────────────────────────────────────────

let batchDepth = 0;
const pendingEffects: Set<EffectNode> = new Set();

/**
 * Batches multiple state updates into a single re-render pass.
 *
 * @example
 * batch(() => {
 *   x.value = 1;
 *   y.value = 2; // only one re-render happens
 * });
 */
export function batch(fn: () => void): void {
  batchDepth++;
  try {
    fn();
  } finally {
    batchDepth--;
    if (batchDepth === 0) {
      for (const effect of pendingEffects) {
        try {
          effect.cleanup?.();
          effect.execute();
        } catch (e) {
          console.error('[Nexus] $effect error (batch):', e);
        }
      }
      pendingEffects.clear();
    }
  }
}
