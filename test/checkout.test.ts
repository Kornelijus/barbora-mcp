import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { previewCheckout } from "../src/checkout.ts";

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("no port");
  return address.port;
}

async function fixtureSession(): Promise<{ dir: string; sessionFile: string }> {
  const dir = await mkdtemp(path.join(tmpdir(), "barbora-checkout-"));
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

test("checkout preview shows the shop lines, address, slot, and total", async () => {
  const seen: string[] = [];
  const server = createServer((req, res) => {
    seen.push(`${req.method} ${req.url}`);
    res.writeHead(200, { "content-type": "application/json" });
    if (req.url === "/proxy/api/v1/cart") {
      res.end(
        JSON.stringify({
          items: [
            {
              type: "Product",
              id: "000000000001335200",
              title: "Pienas",
              quantity: 1,
              price: 1.19,
              isAlcohol: false,
            },
          ],
          summary: { prices: { totalPrice: 9.99 } },
          ageRestriction: { status: "clear", minimumAge: 0 },
        }),
      );
      return;
    }
    if (req.url === "/proxy/api/v1/timeslot/summary") {
      res.end(JSON.stringify({ selected: { deliveryTime: "Tue 10:00-12:00", price: 0 } }));
      return;
    }
    if (req.url === "/proxy/api/v1/address") {
      res.end(
        JSON.stringify({
          addresses: [
            { isSelectedForCart: false, addressWithFlat: "Other street 2" },
            { isSelectedForCart: true, addressWithFlat: "Gedimino pr. 1-5, Vilnius" },
          ],
        }),
      );
      return;
    }
    res.writeHead(500);
    res.end("{}");
  });
  const port = await listen(server);
  const { dir, sessionFile } = await fixtureSession();
  try {
    const result = await previewCheckout({ sessionFile, origin: `http://127.0.0.1:${port}` });
    assert.deepEqual(result, {
      ok: true,
      preview: {
        lines: [{ id: "000000000001335200", title: "Pienas", quantity: 1, price: 1.19, ageLimited: false }],
        total: 9.99,
        address: "Gedimino pr. 1-5, Vilnius",
        slot: "Tue 10:00-12:00",
        ageCheck: null,
      },
    });
    assert.deepEqual(seen.sort(), [
      "GET /proxy/api/v1/address",
      "GET /proxy/api/v1/cart",
      "GET /proxy/api/v1/timeslot/summary",
    ]);
  } finally {
    server.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("a missing slot is reported and the order is not placed", async () => {
  const seen: string[] = [];
  const server = createServer((req, res) => {
    seen.push(`${req.method} ${req.url}`);
    res.writeHead(200, { "content-type": "application/json" });
    if (req.url === "/proxy/api/v1/cart") {
      res.end(
        JSON.stringify({
          items: [],
          summary: { prices: { totalPrice: 0 } },
          ageRestriction: { status: "requiresVerification", minimumAge: 20 },
        }),
      );
      return;
    }
    if (req.url === "/proxy/api/v1/timeslot/summary") {
      res.end(JSON.stringify({ selected: null }));
      return;
    }
    if (req.url === "/proxy/api/v1/address") {
      res.end(JSON.stringify({ addresses: [] }));
      return;
    }
    res.writeHead(500);
    res.end("{}");
  });
  const port = await listen(server);
  const { dir, sessionFile } = await fixtureSession();
  try {
    const result = await previewCheckout({ sessionFile, origin: `http://127.0.0.1:${port}` });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.preview.slot, null);
    assert.equal(result.preview.address, null);
    assert.equal(result.preview.ageCheck, "requiresVerification");
    assert.equal(seen.some((call) => call.includes("submit") || call.includes("payments")), false);
  } finally {
    server.close();
    await rm(dir, { recursive: true, force: true });
  }
});
