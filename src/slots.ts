import { shopExchange, shopJson } from "./cart.ts";

export type SlotWindow = {
  dayId: string;
  timeslotId: string;
  hour: string;
  price: number;
  deliveryTime: string;
};

export type SlotListResult =
  | { ok: true; slots: SlotWindow[] }
  | { ok: false; reason: "signed-out" }
  | { ok: false; reason: "rejected"; status: number };

export type BookSlotResult =
  | { ok: true; slot: SlotWindow }
  | { ok: false; reason: "signed-out" }
  | { ok: false; reason: "unavailable" }
  | { ok: false; reason: "rejected"; status: number };

const UNAVAILABLE = new Set([
  "timeslotNotAvailable",
  "timeslotNotAvailableForAlcohol",
  "timeslotIsUnavailableBecauseOfAlcoholSellingDelay",
]);

export async function bookSlot(input: {
  sessionFile: string;
  origin?: string;
  dayId: string;
  timeslotId: string;
}): Promise<BookSlotResult> {
  const sent = await shopExchange({
    sessionFile: input.sessionFile,
    origin: input.origin,
    method: "POST",
    path: "/proxy/api/v2/timeslot/reserve",
    body: { dayId: input.dayId, timeslotId: input.timeslotId, forceChange: false },
  });
  if (!sent.ok) {
    if (sent.reason === "rejected" && unavailable(sent.body)) return { ok: false, reason: "unavailable" };
    return sent.reason === "signed-out" ? sent : { ok: false, reason: "rejected", status: sent.status };
  }
  const slot = selectedWindow(sent.body);
  if (!slot) return { ok: false, reason: "rejected", status: sent.status };
  return { ok: true, slot };
}

export function formatSlots(result: SlotListResult): string {
  if (!result.ok) {
    if (result.reason === "signed-out") return "Sign in before choosing a slot.";
    return `Barbora rejected the slot list (${result.status}).`;
  }
  if (result.slots.length === 0) return "No slots are open.";
  return result.slots.map((slot) => `${slot.dayId} — ${slot.hour} — ${slot.price} — ${slot.timeslotId}`).join("\n");
}

export function formatBook(result: BookSlotResult): string {
  if (result.ok) return `Reserved ${result.slot.hour} on ${result.slot.dayId}.\nDelivery — ${result.slot.price}`;
  if (result.reason === "signed-out") return "Sign in before choosing a slot.";
  if (result.reason === "unavailable") return "That slot is no longer available.";
  return `Barbora rejected the slot (${result.status}).`;
}

export async function listSlots(input: { sessionFile: string; origin?: string }): Promise<SlotListResult> {
  const grid = await shopJson({ ...input, path: "/proxy/api/v1/timeslot" });
  if (!grid.ok) return grid;
  return { ok: true, slots: windowsFrom(grid.body) };
}

function unavailable(body: unknown): boolean {
  if (!body || typeof body !== "object") return false;
  const code = (body as { code?: unknown }).code;
  return typeof code === "string" && UNAVAILABLE.has(code);
}

function selectedWindow(body: unknown): SlotWindow | undefined {
  if (!body || typeof body !== "object") return undefined;
  const selected = (body as { selected?: unknown }).selected;
  return windowFrom(dayIdOf(selected), selected, true);
}

function dayIdOf(selected: unknown): string {
  if (!selected || typeof selected !== "object") return "";
  const dayId = (selected as { dayId?: unknown }).dayId;
  return typeof dayId === "string" ? dayId : "";
}

function windowsFrom(body: unknown): SlotWindow[] {
  if (!body || typeof body !== "object") return [];
  const days = (body as { days?: unknown }).days;
  if (!Array.isArray(days)) return [];
  const slots: SlotWindow[] = [];
  for (const day of days) {
    if (!day || typeof day !== "object") continue;
    const dayId = (day as { id?: unknown }).id;
    const hours = (day as { hours?: unknown }).hours;
    if (typeof dayId !== "string" || !Array.isArray(hours)) continue;
    for (const hour of hours) {
      const window = windowFrom(dayId, hour);
      if (window) slots.push(window);
    }
  }
  return slots;
}

function windowFrom(dayId: string, hour: unknown, requireOwnDay = false): SlotWindow | undefined {
  if (!hour || typeof hour !== "object") return undefined;
  const record = hour as {
    id?: unknown;
    dayId?: unknown;
    hour?: unknown;
    price?: unknown;
    deliveryTime?: unknown;
    availableAlcohol?: unknown;
  };
  const timeslotId = record.id;
  const label = record.hour;
  const price = record.price;
  const deliveryTime = record.deliveryTime;
  if (record.availableAlcohol === false) return undefined;
  if (typeof timeslotId !== "string" || typeof label !== "string" || typeof price !== "number" || typeof deliveryTime !== "string") {
    return undefined;
  }
  const ownDay = typeof record.dayId === "string" && record.dayId.length > 0 ? record.dayId : "";
  const resolved = ownDay || (!requireOwnDay ? dayId : "");
  if (!resolved) return undefined;
  return { dayId: resolved, timeslotId, hour: label, price, deliveryTime };
}
