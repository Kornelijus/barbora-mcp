import { shopExchange } from "./cart.ts";
import { previewCheckout } from "./checkout.ts";

export type OrderConfirm = {
  total: number;
  address: string;
  slot: string;
};

export type PlaceResult =
  | { ok: true; orderId: string | null }
  | { ok: false; reason: "signed-out" }
  | { ok: false; reason: "rejected"; status: number }
  | { ok: false; reason: "incomplete" }
  | { ok: false; reason: "mismatch" }
  | { ok: false; reason: "payment"; url: string };

export async function placeOrder(input: {
  sessionFile: string;
  origin?: string;
  confirm: OrderConfirm;
}): Promise<PlaceResult> {
  const preview = await previewCheckout({ sessionFile: input.sessionFile, origin: input.origin });
  if (!preview.ok) return preview;
  const checkout = preview.preview;
  if (checkout.address === null || checkout.slot === null || checkout.ageCheck !== null) {
    return { ok: false, reason: "incomplete" };
  }
  if (
    input.confirm.total !== checkout.total ||
    input.confirm.address !== checkout.address ||
    input.confirm.slot !== checkout.slot
  ) {
    return { ok: false, reason: "mismatch" };
  }
  const sent = await shopExchange({
    sessionFile: input.sessionFile,
    origin: input.origin,
    method: "POST",
    path: "/proxy/api/v1/cart/submit",
    // The shop client posts JSON. The saved source does not name these fields, so the body stays empty.
    body: {},
  });
  if (!sent.ok) return sent;
  const url = paymentUrl(sent.body, sent.location);
  if (url) return { ok: false, reason: "payment", url };
  return { ok: true, orderId: orderIdOf(sent.body) };
}

export function formatPlace(result: PlaceResult): string {
  if (result.ok) {
    return result.orderId ? `The shop accepted the order.\n${result.orderId}` : "The shop accepted the order.";
  }
  if (result.reason === "signed-out") return "Sign in before placing the order.";
  if (result.reason === "incomplete") return "An address, a slot, or the age check is still open. The order was not placed.";
  if (result.reason === "mismatch") return "That confirm does not match the latest checkout. The order was not placed.";
  if (result.reason === "payment") return `The shopper still has to finish this payment step.\n${result.url}`;
  return `Barbora rejected the order (${result.status}).`;
}

function paymentUrl(body: unknown, location: string | null): string | undefined {
  const payment = field(body, "payment");
  const candidates = [
    location,
    field(body, "url"),
    field(body, "redirectUrl"),
    field(payment, "url"),
    field(payment, "redirectUrl"),
  ];
  return candidates.find((value): value is string => typeof value === "string" && value.startsWith("http"));
}

function orderIdOf(body: unknown): string | null {
  const id = field(body, "id") ?? field(body, "orderId");
  return typeof id === "string" && id.length > 0 ? id : null;
}

function field(body: unknown, key: string): unknown {
  if (!body || typeof body !== "object") return undefined;
  return (body as Record<string, unknown>)[key];
}
