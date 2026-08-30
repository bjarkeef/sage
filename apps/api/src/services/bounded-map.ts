/** Run `fn` over `items` with at most `limit` in flight, preserving order.
 *
 *  `Promise.all` over a portfolio's symbols is free while the calls are store
 *  reads. Once any of them can become an upstream fetch, a fifty-holding book
 *  would open fifty connections at once. */
export async function mapBounded<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i]!);
    }
  });
  await Promise.all(workers);
  return out;
}
