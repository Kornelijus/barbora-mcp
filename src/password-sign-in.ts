import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export type Country = "LT" | "EE" | "LV";

export type SessionCookie = {
  name: string;
  value: string;
  domain: string;
  path: string;
};

export type Session = {
  country: Country;
  cookies: SessionCookie[];
  createdAt: string;
};

const SHOP_TARGET: Record<Country, string> = {
  LT: "LT_MAIN_WEB",
  EE: "EE_MAIN_WEB",
  LV: "LV_MAIN_WEB",
};

const SHOP_ORIGIN: Record<Country, string> = {
  LT: "https://barbora.lt",
  EE: "https://barbora.ee",
  LV: "https://barbora.lv",
};

export type SignInResult =
  | { ok: true; session: Session }
  | { ok: false; reason: "invalid-credentials" | "rejected"; status: number };

export async function signInWithPassword(input: {
  email: string;
  password: string;
  country: Country;
  rememberMe?: boolean;
  sessionFile: string;
  origin?: string;
}): Promise<SignInResult> {
  const origin = input.origin ?? SHOP_ORIGIN[input.country];
  const rememberMe = input.rememberMe ?? true;
  const response = await fetch(new URL("/proxy/api/v1/auth/login", origin), {
    method: "POST",
    redirect: "manual",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "x-target": SHOP_TARGET[input.country],
      origin,
      referer: new URL("/login", origin).toString(),
    },
    body: JSON.stringify({
      email: input.email,
      password: input.password,
      rememberMe,
    }),
  });

  if (!response.ok) {
    const code = await errorCode(response);
    if (response.status === 400 && code === "invalidCredentials") {
      return { ok: false, reason: "invalid-credentials", status: response.status };
    }
    return { ok: false, reason: "rejected", status: response.status };
  }

  const host = new URL(origin).hostname;
  const session: Session = {
    country: input.country,
    cookies: response.headers.getSetCookie().map((raw) => parseSetCookie(raw, host)),
    createdAt: new Date().toISOString(),
  };
  await mkdir(path.dirname(input.sessionFile), { recursive: true });
  await writeFile(input.sessionFile, JSON.stringify(session, null, 2), { mode: 0o600 });
  await chmod(input.sessionFile, 0o600);
  return { ok: true, session };
}

export async function loadSession(sessionFile: string): Promise<Session | null> {
  try {
    return JSON.parse(await readFile(sessionFile, "utf8")) as Session;
  } catch (error) {
    if (isMissingFile(error)) return null;
    throw error;
  }
}

async function errorCode(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as { code?: string };
    return payload.code ?? "";
  } catch {
    return "";
  }
}

function parseSetCookie(raw: string, host: string): SessionCookie {
  const [pair, ...attributes] = raw.split(";").map((part) => part.trim());
  const splitAt = pair.indexOf("=");
  const name = pair.slice(0, splitAt);
  const value = pair.slice(splitAt + 1);
  let domain = host;
  let cookiePath = "/";
  for (const attribute of attributes) {
    const [key, attributeValue] = attribute.split("=");
    if (key.toLowerCase() === "domain" && attributeValue) domain = attributeValue.replace(/^\./, "");
    if (key.toLowerCase() === "path" && attributeValue) cookiePath = attributeValue;
  }
  return { name, value, domain, path: cookiePath };
}

function isMissingFile(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
