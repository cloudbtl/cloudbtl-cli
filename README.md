# CloudBTL CLI

**Land a folder. Keep its provenance. Resume anytime.**

[![CI](https://github.com/cloudbtl/cloudbtl-cli/actions/workflows/ci.yml/badge.svg)](https://github.com/cloudbtl/cloudbtl-cli/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D18-339933?logo=nodedotjs&logoColor=white)](package.json)

The CloudBTL CLI moves documents from a laptop, shared drive, or migration job into [CloudBTL](https://cloudbtl.com). It hashes files before upload, preserves their source paths, skips duplicate content, records every result in a resumable manifest, and can return machine-readable output to scripts and agents.

It also manages the other side of a document's life: tracked share links, workspace folders, access, and read analytics.

```text
files and folders
      │
      ▼
 scan → hash → deduplicate → land → extract descriptors
      │                         │
      └── resumable manifest    └── source path · version · provenance
```

| Use | Command | Creates a share link? |
| --- | --- | --- |
| Import a corpus for search, enrichment, or migration | `cloudbtl land` | No, unless `--link` is explicit |
| Send one document and track how it is read | `cloudbtl upload` | Yes |

## Quick start

You need Node.js 18 or newer. A dry run works without an account; landing files requires a CloudBTL account and writes to `https://cloudbtl.com` unless you select a tenant host with `cloudbtl config --api-base`.

Install from source:

```bash
git clone https://github.com/cloudbtl/cloudbtl-cli.git
cd cloudbtl-cli
npm install
npm run build
npm link
```

Sign in and inspect a directory without uploading anything:

```bash
cloudbtl login

cloudbtl land ~/Documents/SharedDrive \
  --recursive \
  --exclude '~$*,.DS_Store' \
  --ref-from-path ~/Documents/SharedDrive \
  --dry-run
```

Typical output:

```text
124 files ready · 8.4GB · 0 resumed · 7 local duplicates
```

Land the same tree with a manifest. If the process stops, run the command again; completed files are skipped.

```bash
cloudbtl land ~/Documents/SharedDrive \
  --recursive \
  --exclude '~$*,.DS_Store' \
  --source shared-drive \
  --ref-from-path ~/Documents/SharedDrive \
  --manifest ./shared-drive-land.jsonl \
  --concurrency 3
```

Landing creates document records without publishing them. Add `--link` only when each landed file should also receive a public share link.

## Why use the CLI?

- **Safe bulk intake.** Scan directories recursively, include or exclude globs, and upload small files in batches.
- **Content deduplication.** SHA-256 hashes collapse identical bytes within a workspace, even when filenames or paths differ.
- **Reliable retries.** A JSONL manifest records landed, deduplicated, and failed files so interrupted work can resume.
- **Source fidelity.** `source`, `sourceRef`, batch IDs, path-derived metadata, and content hashes travel with each document.
- **Large-file support.** Files above the multipart threshold go directly to object storage; the server accepts files up to its configured 2 GiB limit.
- **Automation-friendly output.** Use `--json`, API tokens, and stable document IDs in CI, migrations, and agent workflows.

## Design principles

1. **Local first.** Scanning and hashing happen on the user's machine. Content moves only when an upload command is explicit.
2. **Resume instead of restart.** Bulk operations are idempotent, manifest-backed, and safe to repeat.
3. **Provenance travels with derivatives.** Every descriptor identifies its producer and version and remains tied to the source content hash.
4. **Landing does not publish.** Storage and sharing are separate actions.
5. **Domain meaning stays outside the client.** The CLI transports metadata and descriptors without embedding one company's taxonomy.
6. **Human and machine interfaces are peers.** Terminal output is readable; `--json` and stable identifiers expose the same operations to code.

## Two document paths

### Land documents for retrieval

Use `land` when the destination is a document lake, retrieval system, or later enrichment pipeline.

```bash
cloudbtl land ./archive --recursive \
  --include '*.pdf,*.pptx,*.docx,*.xlsx' \
  --ref-from-path ./archive \
  --meta-from-path '^(?<department>[^/]+)/(?<year>20[0-9]{2})/' \
  --manifest ./archive.jsonl

cloudbtl descriptors prop_abc123 --kind text.page
cloudbtl jobs prop_abc123
```

Baseline extraction records deterministic facts such as file type, page count, and available text. External enrichers can write additional descriptors under their own producer identity.

Use `--no-baseline` for large imports that should be extracted later by the server pipeline.

### Upload a document to share

Use `upload` when the immediate result should be a tracked link.

```bash
# Public link
cloudbtl upload proposal.pdf --title "Q3 proposal"

# Recipient must sign in with an allowed email domain
cloudbtl upload proposal.pdf --access org --domains example.org

# Passcode-protected link
cloudbtl upload proposal.pdf --access passcode --passcode correct-horse-42

cloudbtl stats 1
cloudbtl open 1
```

Document references accept a full ID, a unique ID prefix, or a one-based index from `cloudbtl ls`.

## Body search (development)

The `search` command requires an API with descriptor search deployed; older servers return 404.

```bash
cloudbtl search "임대료 조건"
cloudbtl --json search "lease rent" --kind text.page --limit 20
cloudbtl search "임대료" --tree folders --node node_example
```

Every keyword must occur in the same extracted page or document card. Results include the document ID, page, source path, producer and a text excerpt. `--cursor` continues the same query. Results use stable ID order, not relevance ranking; unprocessed files and folder summaries are not searched. Workspace and document access are enforced by the API.

## Authentication

Interactive login opens a browser:

```bash
cloudbtl login
cloudbtl whoami
```

For agents and CI, create an API token once and provide it through the environment:

```bash
cloudbtl token create --name ingestion-worker
CLOUDBTL_TOKEN=cbtl_xxxxxxxx cloudbtl --json land ./incoming --recursive
```

The secret is shown once. Keep it out of manifests, source metadata, command history, and repository files.

Anonymous `upload` is also supported. Its management credential is stored in `~/.config/cloudbtl/config.json` with mode `600`; without an authenticated account, `cloudbtl ls` shows only uploads tracked in that local registry.

## Workspaces and custom domains

Point the client at a tenant host before signing in:

```bash
cloudbtl config --api-base https://acme.cloudbtl.com
cloudbtl login
cloudbtl land ./records --recursive --project PROJECT-2026
```

The CLI uses the selected host for workspace membership, folders, projects, and generated share links. `--project` applies only to tenant workspaces.

## Command map

| Area | Commands |
| --- | --- |
| Authentication | `login`, `logout`, `whoami`, `token create/ls/rm` |
| Intake | `upload`, `land`, `claim` |
| Processing | `descriptors`, `jobs` |
| Retrieval | `search` (requires descriptor-search API) |
| Documents | `ls`, `open`, `rm` |
| Sharing | `links`, `link add`, `link rm`, `stats` |
| Workspace | `folder …`, `org …`, `image add` |
| Configuration | `config` |

Run `cloudbtl help <command>` for the complete option contract.

## Development

```bash
npm install
npm run typecheck
npm run build
npm test --if-present
```

CI also verifies the npm package contents with `npm pack --dry-run` and audits dependencies.

## Security

Please report vulnerabilities privately as described in [SECURITY.md](SECURITY.md).

## License

Apache License 2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
