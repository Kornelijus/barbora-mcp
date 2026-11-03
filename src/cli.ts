import { stdin, stdout } from "node:process";
import { homedir } from "node:os";
import path from "node:path";
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

async function login(): Promise<number> {
  const email = argument("--email");
  const country = argument("--country") ?? "LT";
  if (!email || !COUNTRIES.has(country as Country)) {
    stdout.write("Usage: login --email you@example.com --country LT|EE|LV\n");
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
  stdout.write("Usage: login --email you@example.com --country LT|EE|LV\n");
  process.exitCode = 1;
} else {
  process.exitCode = await login();
}
