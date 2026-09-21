# cloudbtl CLI

CloudBTL is a document landing layer for decision models, with tracked sharing on the same records. It preserves a file or source link with its hash, source path and version; deterministic extractors and external enrichers add provenance-carrying descriptors; trees expose those records as compact options to JevRAG or another consumer.

This is the command-line client for [cloudbtl.com](https://cloudbtl.com). Use it to land stored or linked documents in bulk, run local descriptor producers without sending content to a managed model, write descriptors back, inspect processing jobs, and manage tracked share links and analytics. The browser is best for throwing in folders; the CLI is the repeatable path for scripts, migrations and local processing.

## Install

```bash
npm install
npm run build
npm link          # makes `cloudbtl` available globally
```

> Requires Node.js 18+ (uses the built-in `fetch`/`FormData`).

## Login (optional, for account-wide management)

```bash
cloudbtl login              # sign in with Google in the browser (recommended)
cloudbtl login --basic      # email + password (password accounts only)
cloudbtl whoami
cloudbtl logout
```

When logged in, `ls` lists your **whole account** and `links`/`stats`/`rm` work on any
of your documents by id — no per-document key needed. Without logging in, the CLI still
works anonymously: `upload` returns a key it stores locally, and `ls` shows only the
documents this CLI uploaded.

- `login` opens a browser, you pick your Google account, and the CLI captures the
  session. It serves a one-page sign-in on `http://localhost:5173` (an authorized origin
  on the cloudbtl OAuth client). Set `CLOUDBTL_OAUTH_PORT` to use a different (authorized)
  port, or `CLOUDBTL_NO_BROWSER=1` to print the URL instead of auto-opening.
- Email/password login only works for accounts that have a password. If you only ever
  "Sign in with Google" on the web, use `--google` here too.

## Usage

```bash
# Upload a document (creates a public share link by default)
cloudbtl upload deck.pdf -t "Q3 Proposal"

# Upload restricted to an organization (recipients verify with Google)
cloudbtl upload deck.pdf -a org -d clientcorp.com,sweetspot.co.kr

# Upload behind a passcode
cloudbtl upload deck.pdf -a passcode -p hunter2secret

# List documents you've uploaded (tracked locally)
cloudbtl ls

# Inspect / manage a document (by id, ls index, or id prefix)
cloudbtl links 1
cloudbtl link add 1 -a org -d clientcorp.com --alias "Client Corp"
cloudbtl link rm 1 link_xxxxxxxx
cloudbtl stats 1
cloudbtl open 1
cloudbtl rm 1 --yes
```

## Headless auth (agents / CI) — API tokens

For environments without a browser (LLM agents, CI), use a personal API token:

```bash
# once, on a machine where you CAN log in with the browser:
cloudbtl login
cloudbtl token create -n my-agent      # prints cbtl_… secret ONCE

# on the headless machine:
cloudbtl login --token cbtl_xxxxxxxx   # verifies + stores it
# or keep it out of the config file entirely:
CLOUDBTL_TOKEN=cbtl_xxxxxxxx cloudbtl upload deck.pdf
```

- The token carries your full account permissions (no scopes yet). Revoke with
  `cloudbtl token rm <tok_…>`; list with `cloudbtl token ls`.
- Works with tenant workspaces too — set `config --api-base` to the tenant host first.

## How it works / auth

The CLI uses the platform's existing model:

- **Upload** is anonymous and returns an `ownerKey` for the document.
- The CLI stores `{ id, ownerKey, … }` in `~/.config/cloudbtl/config.json` (mode `600`) and uses the `ownerKey` to manage links and read analytics.
- So `ls` lists documents **this CLI uploaded** — not your full browser account. Keep the config file safe: the `ownerKey` is the document's management credential.

Point the CLI at a different backend (e.g. local dev) with:

```bash
cloudbtl config --api-base http://localhost:8081
```

## Tenant workspaces (subdomain / custom domain)

Uploads against the root domain are **personal** documents. To upload into an
organization workspace, point the CLI at the tenant's host first — its subdomain
(`{org}.cloudbtl.com`) or the org's custom domain if one is configured:

```bash
cloudbtl config --api-base https://acme.cloudbtl.com   # or the org's custom domain
cloudbtl login                                         # must be an org member
cloudbtl upload deck.pdf -t "Q3 Proposal" --project P2026-01
```

- `--project <code>` groups the document under the workspace project (folder) with
  that code, creating it on first use. Omit it to leave the document unfiled.
- Share links inherit the tenant's domain (custom domain preferred), so recipients
  see the org's brand, not cloudbtl.com.
- `--project` only works on a tenant host — on the root domain it is ignored.

## Commands

| Command | Description |
|---|---|
| `upload <file>` | Upload a PDF/HTML/MD/PPTX doc and create its first link |
| `land <files...>` | Land files or directory trees with sha256 dedupe, manifests, resume and automatic batching (see below) |
| `descriptors <doc>` | Derived descriptors for a document (built-in text pages, enricher outputs) |
| `jobs <doc>` | Processing ledger for a document (baseline extraction, external enrichment) |
| `ls` | List locally-tracked documents |
| `links <doc>` | List a document's share links |
| `link add <doc>` | Create an additional share link |
| `link rm <doc> <linkId>` | Delete a share link |
| `stats <doc>` | Visitors, per-page dwell, recent activity |
| `open <doc>` | Open the dashboard in a browser |
| `rm <doc> --yes` | Delete the document and all its data |
| `config [--api-base <url>]` | Show config or set the API base |

`<doc>` accepts a full id (`prop_…`), a 1-based `ls` index, or a unique id prefix.

## Landing (bulk, headless)

`land` is the entry point for scripts and agents that throw many files into a workspace at once. Nothing is published:
no share link is created (unless `--link`), identical bytes in the same workspace collapse to one document
(`--no-dedupe` to disable), and CloudBTL runs its built-in baseline extraction inline (PDF text layer,
HTML/Markdown text, page count) so the response already tells you what it read.

```bash
cloudbtl login --token cbtl_…
cloudbtl config --api-base https://acme.cloudbtl.com

# Inspect a tree without uploading. Include/exclude patterns match paths and filenames.
cloudbtl land ./OneDrive --recursive \
  --include '*.pdf,*.pptx,*.docx,*.xlsx' \
  --exclude '~$*,.DS_Store' \
  --ref-from-path ./OneDrive \
  --dry-run

# Run it. The JSONL manifest records every result; rerunning skips successful paths.
cloudbtl land ./OneDrive --recursive \
  --exclude '~$*,.DS_Store' \
  --source onedrive \
  --ref-from-path ./OneDrive \
  --manifest ./onedrive-land.jsonl \
  --concurrency 3

# Optional: derive per-file metadata from its relative source path.
cloudbtl land ./OneDrive --recursive \
  --ref-from-path ./OneDrive \
  --meta-from-path '^(?<division>[^/]+)/(?<year>20[0-9]{2})/' \
  --manifest ./onedrive-land.jsonl

cloudbtl descriptors prop_… -k text.page
cloudbtl jobs prop_…
```

`land` hashes files locally, removes local duplicates, groups small files into requests of at most 50 files and 25 MB, and sends files of 25 MB or more directly to storage (up to the server's 2 GiB limit). HTTP 429 responses honor `Retry-After` and back off automatically. A stopped run resumes from entries marked `landed` or `deduplicated` in the manifest; failed entries are retried.

Use `--no-baseline` for very large corpora and drain later with `POST /api/pipeline/drain`. Full contract, webhooks and the enricher/consumer guides live in `cloudbtl-site/docs/spec/landing-layer.md`.
