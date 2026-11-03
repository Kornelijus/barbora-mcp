import { stdin, stdout } from "node:process";
import { homedir } from "node:os";
import path from "node:path";
import { signInWithBrowser } from "./browser-sign-in.ts";
import { addToCart, changeQuantity, readCart, removeLine, type CartResult, type CartUnit } from "./cart.ts";
import { chromeLauncher } from "./chrome-launcher.ts";
import { signInWithPassword, type Country } from "./password-sign-in.ts";

const COUNTRIES = new Set<Country>(["LT", "EE", "LV"]);

function sessionFile(): string {
  return path.join(homedir(), ".config", "barbora", "session.json");
}

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

function usage(): void {
  stdout.write("Usage: login --email you@example.com --country LT|EE|LV\n");
  stdout.write("       login --browser --country LT|EE|LV\n");
  stdout.write("       cart\n");
  stdout.write("       cart add --id <id> --quantity <n> --min <n> --max <n> --step <n>\n");
  stdout.write("       cart set --id <id> --quantity <n> --min <n> --max <n> --step <n>\n");
  stdout.write("       cart remove --id <id>\n");
}

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stdin.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf8").trim()));
    stdin.on("error", reject);
  });
}

function readHiddenPassword(): Promise<string> {
  stdout.write("Barbora password: ");
  stdin.setRawMode(true);
  stdin.resume();
  return new Promise((resolve) => {
    let password = "";
    const onData = (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      if (text === "\u0003") {
        stdin.setRawMode(false);
        stdin.off("data", onData);
        process.exit(1);
      }
      if (text === "\n" || text === "\r" || text === "\u0004") {
        stdin.setRawMode(false);
        stdin.off("data", onData);
        stdout.write("\n");
        resolve(password);
        return;
      }
      if (text === "\u007f" || text === "\b") {
        password = password.slice(0, -1);
        return;
      }
      password += text;
    };
    stdin.on("data", onData);
  });
}

async function readPassword(): Promise<string> {
  if (process.argv.includes("--password-stdin") || !stdin.isTTY) return readStdin();
  return readHiddenPassword();
}

async function browserLogin(country: Country): Promise<number> {
  stdout.write("A Chrome window will open. Sign in there, then leave it open until this command finishes.\n");
  try {
    const result = await signInWithBrowser({
      country,
      sessionFile: argument("--session-file") ?? sessionFile(),
      origin: argument("--origin"),
      launcher: chromeLauncher(),
    });
    if (!result.ok) {
      const message =
        result.reason === "timed-out"
          ? "Sign-in timed out before Barbora accepted it.\n"
          : "Sign-in was cancelled before Barbora accepted it.\n";
      stdout.write(message);
      return 1;
    }
    stdout.write(`Signed in to Barbora ${result.session.country}.\n`);
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Browser sign-in failed.";
    stdout.write(`${message}\n`);
    if (message.includes("playwright")) {
      stdout.write("Install it with: npm install playwright\n");
    }
    return 1;
  }
}

async function login(): Promise<number> {
  const country = argument("--country") ?? "LT";
  if (!COUNTRIES.has(country as Country)) {
    usage();
    return 1;
  }
  if (process.argv.includes("--browser")) return browserLogin(country as Country);
  const email = argument("--email");
  if (!email) {
    usage();
    return 1;
  }
  const password = await readPassword();
  const result = await signInWithPassword({
    email,
    password,
    country: country as Country,
    rememberMe: true,
    sessionFile: argument("--session-file") ?? sessionFile(),
    origin: argument("--origin"),
  });
  if (!result.ok) {
    const message =
      result.reason === "invalid-credentials"
        ? "Barbora rejected that email or password."
        : `Barbora rejected sign-in (${result.status}).`;
    stdout.write(`${message}\n`);
    return 1;
  }
  stdout.write(`Signed in to Barbora ${result.session.country}.\n`);
  return 0;
}

function printCart(result: CartResult): number {
  if (!result.ok) {
    const message =
      result.reason === "signed-out"
        ? "Sign in before using the cart.\n"
        : result.reason === "quantity"
          ? "That quantity is outside the unit the shop sells.\n"
          : `Barbora rejected the cart (${result.status}).\n`;
    stdout.write(message);
    return 1;
  }
  if (result.cart.lines.length === 0) stdout.write("The cart is empty.\n");
  for (const line of result.cart.lines) {
    stdout.write(`${line.title} — ${line.quantity} — ${line.price}\n`);
  }
  stdout.write(`Total — ${result.cart.total}\n`);
  return 0;
}

async function cartCommand(): Promise<number> {
  const file = argument("--session-file") ?? sessionFile();
  const origin = argument("--origin");
  const action = process.argv[3];
  if (!action || action.startsWith("--")) return printCart(await readCart({ sessionFile: file, origin }));
  const productId = argument("--id");
  if (!productId || !["add", "set", "remove"].includes(action)) {
    usage();
    return 1;
  }
  if (action === "remove") return printCart(await removeLine({ sessionFile: file, origin, productId }));
  const quantity = Number(argument("--quantity"));
  if (!Number.isFinite(quantity)) {
    usage();
    return 1;
  }
  const unit = readUnit();
  if (unit === "incomplete") {
    usage();
    return 1;
  }
  if (action === "add") return printCart(await addToCart({ sessionFile: file, origin, productId, quantity, unit }));
  return printCart(await changeQuantity({ sessionFile: file, origin, productId, quantity, unit }));
}

function readUnit(): CartUnit | undefined | "incomplete" {
  const min = argument("--min");
  const max = argument("--max");
  const step = argument("--step");
  if (min === undefined && max === undefined && step === undefined) return undefined;
  if (min === undefined || max === undefined || step === undefined) return "incomplete";
  const unit = { min: Number(min), max: Number(max), step: Number(step) };
  if (!Number.isFinite(unit.min) || !Number.isFinite(unit.max) || !Number.isFinite(unit.step) || unit.step <= 0) {
    return "incomplete";
  }
  return unit;
}

const command = process.argv[2];
if (command === "login") process.exitCode = await login();
else if (command === "cart") process.exitCode = await cartCommand();
else {
  usage();
  process.exitCode = 1;
}
