import { shopJson } from "./cart.ts";
import type { CartLine } from "./cart.ts";

export type PreviewLine = CartLine & {
  ageLimited: boolean;
};

export type CheckoutPreview = {
  lines: PreviewLine[];
  total: number;
  address: string | null;
  slot: string | null;
  ageCheck: "requiresVerification" | "ageRestricted" | null;
};

export type PreviewResult =
  | { ok: true; preview: CheckoutPreview }
  | { ok: false; reason: "signed-out" }
  | { ok: false; reason: "rejected"; status: number };

export async function previewCheckout(input: { sessionFile: string; origin?: string }): Promise<PreviewResult> {
  const cart = await shopJson({ ...input, path: "/proxy/api/v1/cart" });
  if (!cart.ok) return cart;
  const slot = await shopJson({ ...input, path: "/proxy/api/v1/timeslot/summary" });
  if (!slot.ok) return slot;
  const address = await shopJson({ ...input, path: "/proxy/api/v1/address" });
  if (!address.ok) return address;
  const parsed = parseCart(cart.body);
  if (!parsed) return { ok: false, reason: "rejected", status: 200 };
  return {
    ok: true,
    preview: {
      ...parsed,
      address: selectedAddress(address.body),
      slot: selectedSlot(slot.body),
    },
  };
}

export function formatPreview(preview: CheckoutPreview): string {
  const lines = preview.lines.map((line) => {
    const age = line.ageLimited ? " — age-limited" : "";
    return `${line.title} — ${line.quantity} — ${line.price}${age}`;
  });
  if (lines.length === 0) lines.push("The cart is empty.");
  lines.push(`Total — ${preview.total}`);
  lines.push(`Address — ${preview.address ?? "An address still has to be chosen."}`);
  lines.push(`Slot — ${preview.slot ?? "A slot still has to be chosen."}`);
  if (preview.ageCheck) lines.push("Age — The shopper still has to complete the age check.");
  return lines.join("\n");
}

function parseCart(body: unknown): Pick<CheckoutPreview, "lines" | "total" | "ageCheck"> | undefined {
  if (!body || typeof body !== "object") return undefined;
  const record = body as {
    items?: unknown[];
    summary?: { prices?: { totalPrice?: unknown } };
    ageRestriction?: { status?: unknown };
  };
  const total = record.summary?.prices?.totalPrice;
  if (typeof total !== "number") return undefined;
  return { lines: linesFrom(record.items ?? []), total, ageCheck: ageCheck(record.ageRestriction?.status) };
}

function ageCheck(status: unknown): CheckoutPreview["ageCheck"] {
  if (status === "requiresVerification" || status === "ageRestricted") return status;
  return null;
}

function linesFrom(items: unknown[]): PreviewLine[] {
  const lines: PreviewLine[] = [];
  for (const entry of items) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as {
      items?: unknown[];
      id?: unknown;
      title?: unknown;
      quantity?: unknown;
      price?: unknown;
      isAlcohol?: unknown;
    };
    if (Array.isArray(record.items)) {
      lines.push(...linesFrom(record.items));
      continue;
    }
    if (typeof record.id !== "string") continue;
    lines.push({
      id: record.id,
      title: typeof record.title === "string" ? record.title : "",
      quantity: typeof record.quantity === "number" ? record.quantity : 0,
      price: typeof record.price === "number" ? record.price : 0,
      ageLimited: record.isAlcohol === true,
    });
  }
  return lines;
}

function selectedAddress(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const addresses = (body as { addresses?: unknown[] }).addresses;
  if (!Array.isArray(addresses)) return null;
  const selected = addresses.find(
    (address) => !!address && typeof address === "object" && (address as { isSelectedForCart?: unknown }).isSelectedForCart === true,
  );
  if (!selected || typeof selected !== "object") return null;
  const text = (selected as { addressWithFlat?: unknown }).addressWithFlat;
  return typeof text === "string" && text.length > 0 ? text : null;
}

function selectedSlot(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const selected = (body as { selected?: unknown }).selected;
  if (!selected || typeof selected !== "object") return null;
  const deliveryTime = (selected as { deliveryTime?: unknown }).deliveryTime;
  return typeof deliveryTime === "string" && deliveryTime.length > 0 ? deliveryTime : null;
}
