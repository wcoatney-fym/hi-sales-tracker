/**
 * Unit tests for the token-bucket rate limiter.
 * Run with: deno test supabase/functions/_shared/rate-limiter.test.ts
 */
import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createRateLimiter } from "./rate-limiter.ts";

Deno.test("acquire: under capacity returns immediately", async () => {
  const limiter = createRateLimiter({ maxRequests: 5, windowMs: 60_000 });
  const start = Date.now();
  await limiter.acquire();
  await limiter.acquire();
  await limiter.acquire();
  const elapsed = Date.now() - start;
  // Should complete nearly instantly (well under 100ms)
  assert(elapsed < 100, `Expected <100ms, got ${elapsed}ms`);
  assertEquals(limiter.currentLoad(), 3);
});

Deno.test("acquire: blocks when bucket is full", async () => {
  // Tiny window (200ms) and low cap (2 req) so the test runs fast.
  const limiter = createRateLimiter({ maxRequests: 2, windowMs: 200 });
  await limiter.acquire(); // req 1
  await limiter.acquire(); // req 2 — bucket now full
  const start = Date.now();
  await limiter.acquire(); // req 3 — should block ~200ms until req 1 expires
  const elapsed = Date.now() - start;
  // Should have waited roughly 200ms (±50ms tolerance for timer jitter)
  assert(elapsed >= 150, `Expected >=150ms wait, got ${elapsed}ms`);
  assert(elapsed < 500, `Expected <500ms wait, got ${elapsed}ms`);
});

Deno.test("currentLoad: returns count within window only", async () => {
  const limiter = createRateLimiter({ maxRequests: 10, windowMs: 150 });
  await limiter.acquire();
  await limiter.acquire();
  assertEquals(limiter.currentLoad(), 2);
  // Wait for the window to expire
  await new Promise((r) => setTimeout(r, 200));
  assertEquals(limiter.currentLoad(), 0);
});

Deno.test("acquire: handles rapid burst correctly", async () => {
  const limiter = createRateLimiter({ maxRequests: 3, windowMs: 300 });
  // Fire 3 quickly — should all succeed without delay
  const start = Date.now();
  await limiter.acquire();
  await limiter.acquire();
  await limiter.acquire();
  const burstElapsed = Date.now() - start;
  assert(burstElapsed < 50, `Burst should be instant, got ${burstElapsed}ms`);

  // 4th should block until the first one ages out of the window (~300ms)
  const blockStart = Date.now();
  await limiter.acquire();
  const blockElapsed = Date.now() - blockStart;
  assert(blockElapsed >= 200, `Expected >=200ms block, got ${blockElapsed}ms`);
});

Deno.test("default options: 80 req / 60s window", () => {
  const limiter = createRateLimiter();
  // Just verify it creates without error and currentLoad starts at 0
  assertEquals(limiter.currentLoad(), 0);
});
