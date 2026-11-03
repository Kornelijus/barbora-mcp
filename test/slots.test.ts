import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { bookSlot, listSlots } from "../src/slots.ts";
import { callTool } from "../src/tools.ts";

const DAY = "2026-11-04";
const SLOT_ID = "c4fe8ffd-b16a-45ac-bfcf-c60ac66d1f94";

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("no port");
  return address.port;
}

async function fixtureSession(): Promise<{ dir: string; sessionFile: string }> {
  const dir = await mkdtemp(path.join(tmpdir(), "barbora-slots-"));
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

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
}

test("reserving a slot sends the day, the hour id, and does not force a change", async () => {
  const seen: string[] = [];
  const bodies: string[] = [];
  const server = createServer(async (req, res) => {
    seen.push(`${req.method} ${req.url}`);
    bodies.push(await readBody(req));
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        reservationExpiration: 2399,
        selected: {
          id: SLOT_ID,
          dayId: DAY,
          deliveryTime: "2026-11-04T08:00:00",
          hour: "08:00 - 09:00",
          price: 2.79,
        },
      }),
    );
  });
  const port = await listen(server);
  const { dir, sessionFile } = await fixtureSession();
  try {
    const result = await bookSlot({
      sessionFile,
      origin: `http://127.0.0.1:${port}`,
      dayId: DAY,
      timeslotId: SLOT_ID,
    });
    assert.deepEqual(result, {
      ok: true,
      slot: {
        dayId: DAY,
        timeslotId: SLOT_ID,
        hour: "08:00 - 09:00",
        price: 2.79,
        deliveryTime: "2026-11-04T08:00:00",
      },
    });
    assert.deepEqual(seen, ["POST /proxy/api/v2/timeslot/reserve"]);
    assert.deepEqual(JSON.parse(bodies[0] ?? ""), { dayId: DAY, timeslotId: SLOT_ID, forceChange: false });
  } finally {
    server.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("the reserve tool reports the hour and does not place an order", async () => {
  const seen: string[] = [];
  const server = createServer(async (req, res) => {
    seen.push(`${req.method} ${req.url}`);
    await readBody(req);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        selected: {
          id: SLOT_ID,
          dayId: DAY,
          deliveryTime: "2026-11-04T08:00:00",
          hour: "08:00 - 09:00",
          price: 2.79,
        },
      }),
    );
  });
  const port = await listen(server);
  const { dir, sessionFile } = await fixtureSession();
  try {
    const result = await callTool(
      "reserve_slot",
      { dayId: DAY, timeslotId: SLOT_ID },
      { sessionFile, origin: `http://127.0.0.1:${port}` },
    );
    assert.equal(result.isError, false);
    assert.equal(result.text, "Reserved 08:00 - 09:00 on 2026-11-04.\nDelivery — 2.79");
    assert.equal(seen.some((call) => call.includes("submit")), false);
    assert.deepEqual(seen, ["POST /proxy/api/v2/timeslot/reserve"]);
  } finally {
    server.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("a slot the shop rejects is not reserved", async () => {
  const seen: string[] = [];
  const server = createServer(async (req, res) => {
    seen.push(`${req.method} ${req.url}`);
    await readBody(req);
    res.writeHead(400, { "content-type": "application/json" });
    res.end(JSON.stringify({ code: "timeslotNotAvailable" }));
  });
  const port = await listen(server);
  const { dir, sessionFile } = await fixtureSession();
  try {
    const result = await bookSlot({
      sessionFile,
      origin: `http://127.0.0.1:${port}`,
      dayId: DAY,
      timeslotId: SLOT_ID,
    });
    assert.deepEqual(result, { ok: false, reason: "unavailable" });
    assert.deepEqual(seen, ["POST /proxy/api/v2/timeslot/reserve"]);
  } finally {
    server.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("open slots use the day's id when the hour has none", async () => {
  const seen: string[] = [];
  const server = createServer((req, res) => {
    seen.push(`${req.method} ${req.url}`);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        days: [
          { id: "2026-11-03", hours: [] },
          {
            id: DAY,
            hours: [
              {
                id: SLOT_ID,
                dayId: null,
                hour: "08:00 - 09:00",
                price: 2.79,
                deliveryTime: "2026-11-04T08:00:00",
              },
            ],
          },
        ],
      }),
    );
  });
  const port = await listen(server);
  const { dir, sessionFile } = await fixtureSession();
  try {
    const result = await listSlots({ sessionFile, origin: `http://127.0.0.1:${port}` });
    assert.deepEqual(result, {
      ok: true,
      slots: [
        {
          dayId: DAY,
          timeslotId: SLOT_ID,
          hour: "08:00 - 09:00",
          price: 2.79,
          deliveryTime: "2026-11-04T08:00:00",
        },
      ],
    });
    assert.deepEqual(seen, ["GET /proxy/api/v1/timeslot"]);
  } finally {
    server.close();
    await rm(dir, { recursive: true, force: true });
  }
});
