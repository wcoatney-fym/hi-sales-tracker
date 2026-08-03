/**
 * Token-bucket rate limiter for outbound API calls.
 *
 * GHL (LeadConnector) enforces 100 requests/minute per location. We target
 * 80 req/min (80% of ceiling) to leave headroom for other integrations
 * hitting the same location concurrently.
 *
 * Usage:
 *   const limiter = createRateLimiter();          // 80 req / 60s default
 *   for (const item of items) {
 *     await limiter.acquire();                     // blocks if bucket is full
 *     await pushContactToGhl(cfg, body);
 *   }
 *
 * The limiter is a sliding-window counter: it tracks the timestamps of the
 * last `maxRequests` calls and sleeps until the oldest one falls outside the
 * window before allowing a new call through.
 */

export interface RateLimiter {
  /** Wait until a request slot is available, then consume one. */
  acquire(): Promise<void>;
  /** How many requests have been made in the current window (diagnostic). */
  currentLoad(): number;
}

export interface RateLimiterOptions {
  /** Maximum requests allowed per window. Default: 80. */
  maxRequests?: number;
  /** Window size in milliseconds. Default: 60_000 (1 minute). */
  windowMs?: number;
}

/**
 * Create a new rate limiter instance. Each instance tracks its own window
 * independently — create one per edge-function invocation.
 */
export function createRateLimiter(opts?: RateLimiterOptions): RateLimiter {
  const maxRequests = opts?.maxRequests ?? 80;
  const windowMs = opts?.windowMs ?? 60_000;

  // Circular buffer of timestamps (ms). Only the last `maxRequests` entries matter.
  const timestamps: number[] = [];

  async function acquire(): Promise<void> {
    const now = Date.now();

    // Evict entries outside the window.
    while (timestamps.length > 0 && timestamps[0] <= now - windowMs) {
      timestamps.shift();
    }

    // If we're at capacity, sleep until the oldest entry expires.
    if (timestamps.length >= maxRequests) {
      const oldest = timestamps[0];
      const sleepMs = oldest + windowMs - now + 1; // +1ms to clear the boundary
      if (sleepMs > 0) {
        console.log(
          `[rate-limiter] bucket full (${timestamps.length}/${maxRequests}), sleeping ${sleepMs}ms`,
        );
        await new Promise((r) => setTimeout(r, sleepMs));
        // After sleeping, re-evict (time has passed).
        const after = Date.now();
        while (timestamps.length > 0 && timestamps[0] <= after - windowMs) {
          timestamps.shift();
        }
      }
    }

    timestamps.push(Date.now());
  }

  function currentLoad(): number {
    const now = Date.now();
    // Count entries within the window without mutating (diagnostic only).
    let count = 0;
    for (let i = timestamps.length - 1; i >= 0; i--) {
      if (timestamps[i] > now - windowMs) count++;
      else break;
    }
    return count;
  }

  return { acquire, currentLoad };
}
