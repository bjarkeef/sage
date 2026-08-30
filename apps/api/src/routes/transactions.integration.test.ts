import { it, expect, beforeAll, afterAll } from "vitest";
import { FakeMarketDataProvider } from "@sage/provider-interface/testing";
import { describeDb, withTestDb, testEnv, signUpTestUser, type TestDb } from "../testing";
import { createApp } from "../app";
import { createAuth } from "../auth";

const apple = {
  symbol: "AAPL",
  name: "Apple Inc",
  exchange: "XNAS",
  currency: "USD",
  assetType: "stock",
};

function buyBody(quantity: string, price: string, tradeDate = "2026-01-01") {
  return { instrument: apple, type: "buy", quantity, price, tradeDate };
}

describeDb("transaction routes", () => {
  let tdb: TestDb;
  let app: ReturnType<typeof createApp>;
  let cookie: string;
  beforeAll(async () => {
    tdb = await withTestDb();
    const auth = createAuth(tdb.db, testEnv);
    app = createApp(tdb.db, new FakeMarketDataProvider(), auth);
    cookie = await signUpTestUser(app);
  }, 120_000);
  afterAll(async () => {
    await tdb?.stop();
  });

  it("creates a transaction and lists it", async () => {
    const create = await app.request("/transactions", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify(buyBody("10", "100")),
    });
    expect(create.status).toBe(201);
    const created = (await create.json()) as { id: string; instrumentSymbol: string };
    expect(created.instrumentSymbol).toBe("AAPL");

    const list = await app.request("/transactions", {
      headers: { cookie },
    });
    expect(list.status).toBe(200);
    const page = (await list.json()) as {
      items: { id: string; name: string }[];
      nextCursor: string | null;
    };
    expect(page.items.some((r) => r.id === created.id)).toBe(true);
    expect(page.items[0]!.name).toBe("Apple Inc");
  });

  it("rejects an oversell with 400", async () => {
    const res = await app.request("/transactions", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        instrument: apple,
        type: "sell",
        quantity: "9999",
        price: "100",
        tradeDate: "2026-02-01",
      }),
    });
    expect(res.status).toBe(400);
  });

  it("rejects invalid input with 400", async () => {
    const res = await app.request("/transactions", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ ...buyBody("-1", "100") }),
    });
    expect(res.status).toBe(400);
  });

  it("deletes a transaction", async () => {
    const create = await app.request("/transactions", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify(buyBody("1", "50", "2026-03-01")),
    });
    const { id } = (await create.json()) as { id: string };
    const del = await app.request(`/transactions/${id}`, {
      method: "DELETE",
      headers: { cookie },
    });
    expect(del.status).toBe(204);
    const delAgain = await app.request(`/transactions/${id}`, {
      method: "DELETE",
      headers: { cookie },
    });
    expect(delAgain.status).toBe(404);
  });

  it("edits a transaction and the change is reflected", async () => {
    const create = await app.request("/transactions", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify(buyBody("4", "100", "2026-04-01")),
    });
    const created = (await create.json()) as { id: string };

    const patch = await app.request(`/transactions/${created.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ type: "buy", quantity: "6", price: "110", tradeDate: "2026-04-02" }),
    });
    expect(patch.status).toBe(200);
    const updated = (await patch.json()) as { quantity: string; price: string; tradeDate: string };
    expect(updated.quantity).toBe("6");
    expect(updated.price).toBe("110");
    expect(updated.tradeDate).toBe("2026-04-02");
  });

  it("rejects an edit that would oversell with 400", async () => {
    // Use a distinct instrument so other AAPL transactions in earlier tests don't interfere.
    const msft = {
      symbol: "MSFT",
      name: "Microsoft Corp",
      exchange: "XNAS",
      currency: "USD",
      assetType: "stock",
    };
    // Buy 5, sell 5 (fully closed), then try to edit the buy down to 1 -> the sell of 5 oversells.
    const buy = await app.request("/transactions", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        instrument: msft,
        type: "buy",
        quantity: "5",
        price: "100",
        tradeDate: "2026-05-01",
      }),
    });
    const buyId = ((await buy.json()) as { id: string }).id;
    await app.request("/transactions", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        instrument: msft,
        type: "sell",
        quantity: "5",
        price: "120",
        tradeDate: "2026-05-02",
      }),
    });
    const patch = await app.request(`/transactions/${buyId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ type: "buy", quantity: "1", price: "100", tradeDate: "2026-05-01" }),
    });
    expect(patch.status).toBe(400);
  });

  it("returns 404 for an unknown transaction id", async () => {
    const res = await app.request("/transactions/00000000-0000-0000-0000-0000000000ff", {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ type: "buy", quantity: "1", price: "1", tradeDate: "2026-01-01" }),
    });
    expect(res.status).toBe(404);
  });

  it("returns 404 for a malformed transaction id", async () => {
    const res = await app.request("/transactions/not-a-uuid", {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ type: "buy", quantity: "1", price: "1", tradeDate: "2026-01-01" }),
    });
    expect(res.status).toBe(404);
  });

  it("rejects an invalid edit body with 400", async () => {
    const create = await app.request("/transactions", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify(buyBody("2", "50", "2026-06-01")),
    });
    const { id } = (await create.json()) as { id: string };
    const res = await app.request(`/transactions/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ type: "buy", quantity: "-1", price: "50", tradeDate: "2026-06-01" }),
    });
    expect(res.status).toBe(400);
  });

  it("stores fee and feeCurrency on a transaction", async () => {
    const res = await app.request("/transactions", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        instrument: apple,
        type: "buy",
        quantity: "3",
        price: "200",
        tradeDate: "2026-07-01",
        fee: "13.50",
        feeCurrency: "DKK",
      }),
    });
    expect(res.status).toBe(201);
    const created = (await res.json()) as { fee: string | null; feeCurrency: string | null };
    expect(created.fee).toBe("13.50");
    expect(created.feeCurrency).toBe("DKK");

    const list = await app.request("/transactions", { headers: { cookie } });
    const page = (await list.json()) as {
      items: { fee: string | null; feeCurrency: string | null }[];
    };
    const match = page.items.find((r) => r.fee === "13.50");
    expect(match).toBeDefined();
    expect(match!.feeCurrency).toBe("DKK");
  });

  it("creates a transaction without fee (null)", async () => {
    const res = await app.request("/transactions", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify(buyBody("2", "150", "2026-07-02")),
    });
    expect(res.status).toBe(201);
    const created = (await res.json()) as { fee: string | null };
    expect(created.fee).toBeNull();
  });

  it("sets and clears a transaction's fee via PATCH", async () => {
    const create = await app.request("/transactions", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify(buyBody("5", "100", "2026-02-01")),
    });
    const { id } = (await create.json()) as { id: string };

    const withFee = await app.request(`/transactions/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        type: "buy",
        quantity: "5",
        price: "100",
        tradeDate: "2026-02-01",
        fee: "2.50",
        feeCurrency: "USD",
      }),
    });
    expect(withFee.status).toBe(200);

    const listed = await app.request("/transactions", { headers: { cookie } });
    const page = (await listed.json()) as {
      items: { id: string; fee: string | null; feeCurrency: string | null }[];
    };
    const row = page.items.find((r) => r.id === id)!;
    expect(Number(row.fee)).toBe(2.5);
    expect(row.feeCurrency).toBe("USD");

    const cleared = await app.request(`/transactions/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ type: "buy", quantity: "5", price: "100", tradeDate: "2026-02-01" }),
    });
    expect(cleared.status).toBe(200);

    const listed2 = await app.request("/transactions", { headers: { cookie } });
    const page2 = (await listed2.json()) as { items: { id: string; fee: string | null }[] };
    expect(page2.items.find((r) => r.id === id)!.fee).toBeNull();
  });

  it("paginates with a cursor", async () => {
    // Ensure several rows exist (prior tests already inserted some).
    for (let i = 0; i < 3; i++) {
      await app.request("/transactions", {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify(buyBody("1", "10", `2026-01-0${i + 1}`)),
      });
    }
    const first = await app.request("/transactions?limit=2", { headers: { cookie } });
    expect(first.status).toBe(200);
    const p1 = (await first.json()) as {
      items: { id: string }[];
      nextCursor: string | null;
    };
    expect(p1.items).toHaveLength(2);
    expect(p1.nextCursor).toBeTruthy();

    const second = await app.request(
      `/transactions?limit=2&cursor=${encodeURIComponent(p1.nextCursor!)}`,
      { headers: { cookie } },
    );
    expect(second.status).toBe(200);
    const p2 = (await second.json()) as { items: { id: string }[]; nextCursor: string | null };
    expect(p2.items.length).toBeGreaterThan(0);
    const overlap = p1.items.some((a) => p2.items.some((b) => b.id === a.id));
    expect(overlap).toBe(false);
  });

  // The currency guard exists to protect FIFO cost basis, which sums lots in a
  // single currency. It is not a rule about the holding as a whole.
  function post(body: unknown) {
    return app.request("/transactions", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify(body),
    });
  }

  it("filters the ledger to one symbol", async () => {
    // The asset page shows just this holding's entries, so it can be undone
    // where it was entered. Without the filter the page would have to pull the
    // whole ledger and discard almost all of it.
    const other = { ...apple, symbol: "FILTERME", name: "Filter Co" };
    expect(
      (
        await post({
          instrument: other,
          type: "buy",
          quantity: "3",
          price: "10",
          tradeDate: "2026-04-01",
        })
      ).status,
    ).toBe(201);

    const res = await app.request("/transactions?symbol=FILTERME", { headers: { cookie } });
    expect(res.status).toBe(200);
    const page = (await res.json()) as { items: { instrumentSymbol: string }[] };
    expect(page.items.length).toBeGreaterThan(0);
    expect(page.items.every((r) => r.instrumentSymbol === "FILTERME")).toBe(true);
  });

  it("returns an empty page for a symbol with nothing in the ledger", async () => {
    // A never-traded symbol must not fall back to the unfiltered ledger — that
    // would show another holding's rows under this one's heading.
    const res = await app.request("/transactions?symbol=NOTHINGHERE", { headers: { cookie } });
    expect(res.status).toBe(200);
    expect((await res.json()) as { items: unknown[] }).toMatchObject({ items: [] });
  });

  it("records a dividend in its payout currency, even when the buys are in another", async () => {
    // Real portfolios do this constantly: a US stock held through a European
    // broker is bought in EUR and pays out in USD. The guard used to compare a
    // new row against *any* existing row for the symbol -- dividends included
    // -- so this second write was refused, even though imported ledgers are
    // already full of exactly this shape.
    const inst = { ...apple, symbol: "PAYOUT", name: "Payout Co", currency: "EUR" };
    const buy = await post({
      instrument: inst,
      type: "buy",
      quantity: "10",
      price: "50",
      tradeDate: "2026-01-01",
    });
    expect(buy.status).toBe(201);

    const div = await post({
      instrument: { ...inst, currency: "USD" },
      type: "dividend",
      quantity: "10",
      price: "0.75",
      tradeDate: "2026-03-01",
    });
    expect(div.status).toBe(201);
  });

  it("still refuses a buy whose currency disagrees with the existing buys", async () => {
    const inst = { ...apple, symbol: "ONECCY", name: "One Currency Co", currency: "EUR" };
    expect(
      (
        await post({
          instrument: inst,
          type: "buy",
          quantity: "5",
          price: "20",
          tradeDate: "2026-01-01",
        })
      ).status,
    ).toBe(201);

    const res = await post({
      instrument: { ...inst, currency: "USD" },
      type: "buy",
      quantity: "5",
      price: "20",
      tradeDate: "2026-02-01",
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: "currency_mismatch",
      symbol: "ONECCY",
      expected: "EUR",
      got: "USD",
    });
  });

  it("compares a new buy against the earliest buy, not a later dividend", async () => {
    // Ordering is load-bearing. The old query was `LIMIT 1` with no ORDER BY,
    // so the row it compared against was whatever the heap scan happened to
    // reach first. With a USD dividend sitting alongside EUR buys, the verdict
    // depended on physical row order rather than on the ledger -- it could
    // flip after any UPDATE or VACUUM, with no code change.
    const inst = { ...apple, symbol: "ORDERED", name: "Ordered Co", currency: "EUR" };
    expect(
      (
        await post({
          instrument: inst,
          type: "buy",
          quantity: "8",
          price: "30",
          tradeDate: "2026-01-01",
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await post({
          instrument: { ...inst, currency: "USD" },
          type: "dividend",
          quantity: "8",
          price: "0.5",
          tradeDate: "2026-02-01",
        })
      ).status,
    ).toBe(201);

    const res = await post({
      instrument: { ...inst, currency: "USD" },
      type: "buy",
      quantity: "8",
      price: "30",
      tradeDate: "2026-03-01",
    });
    expect(res.status).toBe(400);
    // EUR from the buy, never USD from the dividend that sits between them.
    expect(await res.json()).toMatchObject({ expected: "EUR", got: "USD" });
  });
});
