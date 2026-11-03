# Barbora agent

Sign a shopper in to [Barbora](https://barbora.lt) and shop with their session. Built for agents such as Grok and Hermes.

The shopper signs in once, either by typing their email and password into a masked prompt, or by logging in inside a browser window the tool opens. The tool stores the session. It does not store the password. Paying still happens with the shopper.

Work is tracked as GitHub issues. The glossary is in `CONTEXT.md`.

## Sign in

Password sign-in asks for a masked password and stores the session at `~/.config/barbora/session.json`. The password is not stored.

```bash
node --experimental-strip-types src/cli.ts login --email you@example.com --country LT
```

`LT`, `EE`, and `LV` are the three shops. `--password-stdin` reads the password from stdin instead of a prompt.

Browser sign-in opens the shop's own login page in Chrome. Google, Facebook, and Apple work there. It needs Playwright and Chrome:

```bash
npm install playwright
node --experimental-strip-types src/cli.ts login --browser --country LT
```

## Catalog

Search the catalog with no session. Titles that start with `UAT` are left out.

```bash
node --experimental-strip-types src/cli.ts search --query pienas --country LT
node --experimental-strip-types src/cli.ts product --slug juoda-rugine-raikyta-mociutes-duona-450-g --country LT
```

```bash
npm test
```

## Status

Password sign-in, browser sign-in, and catalog search work. The cart and checkout are separate issues. Nothing here places an order yet.
