# Barbora agent

An agent signs a shopper in to Barbora and shops with that shopper's session. The password is never stored. Payment stays with the shopper.

## Agent skills

### Issue tracker

Issues and specs live as GitHub issues on this repo. See `docs/agents/issue-tracker.md`.

### Triage labels

The five triage roles use the label strings `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, and `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context. The glossary is `CONTEXT.md`. ADRs live in `docs/adr/`. See `docs/agents/domain.md`.

## Working a ticket

Claim the issue before the first product edit (`gh issue edit <n> --add-assignee @me`). Branch from `master`. Open a pull request when the slice is done.

Use the words in `CONTEXT.md`. Do not store a password. Do not place an order unless the ticket says the shopper confirmed that exact basket.
