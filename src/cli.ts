import { stdin, stdout } from "node:process";
import { homedir } from "node:os";
import path from "node:path";
import { signInWithBrowser } from "./browser-sign-in.ts";
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

const command = process.argv[2];
if (command !== "login") {
  usage();
  process.exitCode = 1;
} else {
  process.exitCode = await login();
}
