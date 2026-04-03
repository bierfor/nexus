/**
 * Nexus Optimistic UI — `$optimistic` rune.
 *
 * Updates the UI instantly before the server responds.
 * Rolls back automatically if the server action fails.
 *
 * Usage:
 *   const likes = $state(post.likes);
 *
 *   function handleLike() {
 *     $optimistic(
 *       likes,
 *       () => likePost(post.id),    // Server Action
 *       post.likes                   // rollback value
 *     );
 *   }
 *
 * What happens:
 *   1. `likes.value` jumps to `likes.value + 1` immediately (UI updates)
 *   2. Server Action runs in background
 *   3a. Success → server value is confirmed (or replaced with server result)
 *   3b. Failure → `likes.value` rolls back to `post.likes`
 */

import { $state, $effect } from './runes.js';

export type OptimisticUpdate<T> = {
  /** Current displayed value (may be optimistic) */
  value: T;
  /** True while the server action is in flight */
  pending: boolean;
  /** Error message if the action failed */
  error: string | null;
};

/**
 * Wraps a server action with optimistic UI.
 * The signal is updated immediately; rolls back on error.
 *
 * @param signal  - A $state signal to update optimistically
 * @param action  - Async function that calls the server (returns new value or void)
 * @param rollback - Value to restore if the action fails (defaults to current value)
 */
export async function $optimistic<T>(
  signal: { value: T },
  action: () => Promise<T | void>,
  rollback?: T,
): Promise<void> {
  const savedValue = rollback ?? signal.value;

  // Apply optimistic update immediately — UI reflects change before server
  const optimisticResult = guessNextValue(signal.value);
  if (optimisticResult !== undefined) {
    signal.value = optimisticResult as T;
  }

  try {
    const serverResult = await action();
    // Server returned a canonical value — use it
    if (serverResult !== undefined && serverResult !== null) {
      signal.value = serverResult;
    }
  } catch (err) {
    // Roll back to the saved value on any error
    signal.value = savedValue;
    console.warn('[Nexus $optimistic] Action failed, rolling back:', err);
  }
}

/**
 * Creates a full optimistic action controller with pending/error state.
 * More powerful than bare $optimistic — gives you loading indicators too.
 *
 * @example
 * const likeAction = createOptimistic(likes, () => likePost(post.id));
 * <button onclick={likeAction.execute} disabled={likeAction.pending}>
 *   {likeAction.pending ? '...' : likes.value} likes
 * </button>
 */
export function createOptimistic<T>(
  signal: { value: T },
  action: (current: T) => Promise<T | void>,
  opts: {
    optimisticValue?: (current: T) => T;
    onError?: (err: unknown) => void;
  } = {},
): {
  execute: () => Promise<void>;
  pending: { value: boolean };
  error: { value: string | null };
} {
  const pending = $state(false);
  const error = $state<string | null>(null);

  const execute = async (): Promise<void> => {
    if (pending.value) return; // Prevent double-submit

    const savedValue = signal.value;
    error.value = null;
    pending.value = true;

    // Apply optimistic update
    if (opts.optimisticValue) {
      signal.value = opts.optimisticValue(savedValue);
    }

    try {
      const result = await action(savedValue);
      if (result !== undefined && result !== null) {
        signal.value = result;
      }
    } catch (err) {
      signal.value = savedValue;
      const msg = err instanceof Error ? err.message : String(err);
      error.value = msg;
      opts.onError?.(err);
    } finally {
      pending.value = false;
    }
  };

  return { execute, pending, error };
}

/** Heuristic: guess next value for common types (numbers, booleans, arrays) */
function guessNextValue<T>(current: T): T | undefined {
  if (typeof current === 'number') return (current + 1) as T;
  if (typeof current === 'boolean') return (!current) as T;
  if (Array.isArray(current)) return [...current] as T; // shallow clone
  return undefined;
}
