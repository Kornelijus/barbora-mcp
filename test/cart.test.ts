import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { addToCart, changeQuantity, readCart, removeLine } from "../src/cart.ts";

const UNIT = { type: "units", min: 1, max: 10, step: 1, initialValue: 1 };

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("no port");
  return address.port;
}

async function fixtureSession(): Promise<{ dir: string; sessionFile: string }> {
  const dir = await mkdtemp(path.join(tmpdir(), "barbora-cart-"));
  const sessionFile = path.join(dir, "session.json");
  await writeFile(
    sessionFile,
    JSON.stringify({
      country: "LT",
      createdAt: "2026-11-03T00:00:00.000Z",
      cookies: [{ name: ".BRBAUTH", value: "shop-session", domain: "127.0.0.1", path: "/" }],
    }),
  );
  return { dir, sessionFile };
}

function cartBody(quantity: number, total: number) {
  return JSON.stringify({
    items: [
      {
        type: "Product",
        id: "000000000001335200",
        title: "Pienas",
        quantity,
        price: 2.38,
        unit: UNIT,
      },
    ],
    summary: { prices: { totalPrice: total } },
  });
}

test("a signed-in shopper can read, add, change, and remove a cart line", async () => {
  const seen: { method: string; url: string; body: string; cookie: string; target: string }[] = [];
  let quantity = 0;
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      seen.push({
        method: req.method ?? "",
        url: req.url ?? "",
        body,
        cookie: req.headers.cookie?.toString() ?? "",
        target: req.headers["x-target"]?.toString() ?? "",
      });
      if (req.method === "POST") quantity = 1;
      if (req.method === "PATCH") quantity = 2;
      if (req.method === "DELETE") quantity = 0;
      res.writeHead(200, { "content-type": "application/json" });
      if (quantity === 0) {
        res.end(JSON.stringify({ items: [], summary: { prices: { totalPrice: 0 } } }));
        return;
      }
      res.end(cartBody(quantity, quantity === 1 ? 9.99 : 8.5));
    });
  });
  const port = await listen(server);
  const { dir, sessionFile } = await fixtureSession();
  const origin = `http://127.0.0.1:${port}`;
  try {
    const empty = await readCart({ sessionFile, origin });
    const added = await addToCart({
      sessionFile,
      origin,
      productId: "000000000001335200",
      quantity: 1,
      unit: UNIT,
    });
    const changed = await changeQuantity({
      sessionFile,
      origin,
      productId: "000000000001335200",
      quantity: 2,
      unit: UNIT,
    });
    const removed = await removeLine({ sessionFile, origin, productId: "000000000001335200" });

    assert.deepEqual(empty, { ok: true, cart: { lines: [], total: 0 } });
    assert.deepEqual(added, {
      ok: true,
      cart: {
        lines: [{ id: "000000000001335200", title: "Pienas", quantity: 1, price: 2.38 }],
        total: 9.99,
      },
    });
    assert.equal(changed.ok && changed.cart.total, 8.5);
    assert.deepEqual(removed, { ok: true, cart: { lines: [], total: 0 } });
    assert.deepEqual(
      seen.map((call) => `${call.method} ${call.url}`),
      [
        "GET /proxy/api/v1/cart",
        "POST /proxy/api/v1/cart/item",
        "GET /proxy/api/v1/cart",
        "PATCH /proxy/api/v1/cart/item/000000000001335200",
        "GET /proxy/api/v1/cart",
        "DELETE /proxy/api/v1/cart/item/000000000001335200",
        "GET /proxy/api/v1/cart",
      ],
    );
    assert.equal(seen[1].body, JSON.stringify({ id: "000000000001335200", quantity: 1 }));
    assert.equal(seen[3].body, JSON.stringify({ quantity: 2 }));
    assert.equal(seen.every((call) => call.cookie === ".BRBAUTH=shop-session"), true);
    assert.equal(seen.every((call) => call.target === "LT_MAIN_WEB"), true);
  } finally {
    server.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("a missing session is signed out and the cart is left unchanged", async () => {
  let calls = 0;
  const server = createServer((_req, res) => {
    calls += 1;
    res.writeHead(200);
    res.end("{}");
  });
  const port = await listen(server);
  const dir = await mkdtemp(path.join(tmpdir(), "barbora-cart-"));
  try {
    const result = await addToCart({
      sessionFile: path.join(dir, "missing.json"),
      origin: `http://127.0.0.1:${port}`,
      productId: "000000000001335200",
      quantity: 1,
      unit: UNIT,
    });
    assert.deepEqual(result, { ok: false, reason: "signed-out" });
    assert.equal(calls, 0);
  } finally {
    server.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("a rejected session is signed out and the cart is left unchanged", async () => {
  const seen: string[] = [];
  const server = createServer((req, res) => {
    seen.push(`${req.method} ${req.url}`);
    res.writeHead(401, { "content-type": "application/json" });
    res.end(JSON.stringify({ message: "Unauthorized", statusCode: 401 }));
  });
  const port = await listen(server);
  const { dir, sessionFile } = await fixtureSession();
  try {
    const result = await readCart({ sessionFile, origin: `http://127.0.0.1:${port}` });
    assert.deepEqual(result, { ok: false, reason: "signed-out" });
    assert.deepEqual(seen, ["GET /proxy/api/v1/cart"]);
  } finally {
    server.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("a quantity outside the shop unit is not sent", async () => {
  let calls = 0;
  const server = createServer((_req, res) => {
    calls += 1;
    res.writeHead(200);
    res.end("{}");
  });
  const port = await listen(server);
  const { dir, sessionFile } = await fixtureSession();
  try {
    const result = await addToCart({
      sessionFile,
      origin: `http://127.0.0.1:${port}`,
      productId: "000000000001335200",
      quantity: 11,
      unit: UNIT,
    });
    assert.deepEqual(result, { ok: false, reason: "quantity" });
    assert.equal(calls, 0);
  } finally {
    server.close();
    await rm(dir, { recursive: true, force: true });
  }
});
