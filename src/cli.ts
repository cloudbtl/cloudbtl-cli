import { Command } from 'commander';
import { ApiClientError } from './api.js';
import { err, setJsonMode } from './format.js';
import {
  cmdClaim,
  cmdConfig,
  cmdLinkAdd,
  cmdLinkRm,
  cmdLinks,
  cmdLogin,
  cmdLogout,
  cmdLs,
  cmdOpen,
  cmdRm,
  cmdStats,
  cmdUpload,
  cmdLand,
  cmdDescriptors,
  cmdSearch,
  cmdJobs,
  cmdImageAdd,
  cmdWhoami,
  cmdTokenCreate,
  cmdTokenLs,
  cmdTokenRm,
  cmdFolderLs,
  cmdFolderCreate,
  cmdFolderRm,
  cmdFolderRename,
  cmdFolderDocs,
  cmdFolderMembers,
  cmdFolderAddMember,
  cmdFolderRmMember,
  cmdOrgLs,
  cmdOrgMembers,
  cmdOrgInvite,
  cmdOrgInvitations,
  cmdOrgRevokeInvite,
  cmdOrgSetRole,
  cmdOrgRmMember,
  cmdOrgDocs,
  cmdOrgAudit,
} from './commands.js';

const program = new Command();

program
  .name('cloudbtl')
  .description(
    'Land files with hashes, source paths, resumable manifests, and provenance.\n' +
      'Then inspect descriptors or create tracked share links — from a terminal, script, or agent.',
  )
  .version('0.1.0')
  .option('--json', 'machine-readable JSON output (for scripts/agents)', false)
  .hook('preAction', () => setJsonMode(Boolean(program.opts().json)));

const accessHelp =
  'access mode: public | passcode | org (org needs --domains; passcode needs --passcode)';

program.command('search')
  .description('Search extracted body text and document/page cards (all keywords must match)')
  .argument('<query>', 'keywords, e.g. "임대료 조건"')
  .option('--kind <kind>', 'text.page | card.doc | card.page')
  .option('--producer <producer>', 'descriptor producer')
  .option('--limit <count>', 'results per page (1–100)', '20')
  .option('--cursor <cursor>', 'continue a previous search')
  .option('--tree <tree>', 'search a logical tree by id or key')
  .option('--node <node>', 'search this node and descendants (requires --tree; default root)')
  .action(cmdSearch);

program
  .command('login')
  .description('Log in with Google in the browser (default); use --basic for email + password')
  .option('-b, --basic', 'log in with email + password instead of Google', false)
  .option('-e, --email <email>', 'account email (implies --basic; otherwise prompted)')
  .option('-p, --password <password>', 'account password (implies --basic; or CLOUDBTL_PASSWORD)')
  .option('--token <token>', 'authenticate with an API token (cbtl_…) — headless/agent use')
  .action(cmdLogin);

program.command('logout').description('Clear the saved session').action(cmdLogout);
program.command('whoami').description('Show the logged-in account').action(cmdWhoami);

program
  .command('upload')
  .description('Upload a PDF/HTML/MD/PPTX document and create its first share link')
  .argument('<file>', 'path to a .pdf / .html / .md / .pptx file')
  .option('-t, --title <title>', 'document title (defaults to the filename)')
  .option('--project <code>', 'group the document under a project (subdomain workspaces only)')
  .option('-a, --access <mode>', accessHelp, 'public')
  .option('-d, --domains <list>', 'comma-separated allowed email domains (for --access org)')
  .option('-p, --passcode <code>', 'passcode (for --access passcode, or org fallback)')
  .option('--download', 'allow recipients to download the file', false)
  .action(cmdUpload);

program
  .command('land')
  .description('Land files or directory trees with sha256 dedupe, resumable manifests and automatic batching.')
  .argument('<files...>', 'file or directory paths (directories require --recursive)')
  .option('-s, --source <name>', "where these came from, e.g. onedrive, openclaw (opaque; stored verbatim)")
  .option('-b, --batch <id>', 'ingest batch id (default: server-generated)')
  .option('-m, --meta <json>', 'metadata JSON object attached to every file, e.g. \'{"division":"LM"}\'')
  .option('-r, --recursive', 'walk directory arguments recursively', false)
  .option('--include <globs>', 'comma-separated include globs, e.g. "*.pdf,**/*.pptx"')
  .option('--exclude <globs>', 'comma-separated exclude globs, e.g. "~$*,.DS_Store"')
  .option('--ref <ref...>', 'per-file source refs (paths/ids in the source system), same order and count as files')
  .option('--ref-from-path <root>', 'set each source ref to its path relative to this root')
  .option('--meta-from-path <pattern>', 'extract metadata from source refs with named {fields} in a regex')
  .option('--manifest <path>', 'append one JSONL result per file and resume successful paths on rerun')
  .option('--dry-run', 'scan and hash without uploading; show count, bytes and local duplicates', false)
  .option('--concurrency <n>', 'parallel upload jobs (1-16)', '3')
  .option('--project <code>', 'group under a project (subdomain workspaces only)')
  .option('--description <text>', 'description shown on the share landing (if a link is later created)')
  .option('--link', 'also create a public share link per file (default: none)', false)
  .option('--no-dedupe', 'always create a new document even if the same bytes already exist')
  .option('--no-baseline', 'skip inline baseline extraction (leave the job queued for /pipeline/drain)')
  .action(cmdLand);

program
  .command('descriptors')
  .description('List derived descriptors (text pages, metadata, enricher outputs) for a document')
  .argument('<id>', 'document id (prop_…) or tracked index')
  .option('-k, --kind <kind>', 'filter by kind, e.g. text.page, doc.meta')
  .option('--producer <name>', 'filter by producer, e.g. cloudbtl-baseline')
  .option('--page <n>', 'filter by page (0 = document level)')
  .action(cmdDescriptors);

program
  .command('jobs')
  .description('Show the processing ledger (baseline extraction, external enrichment) for a document')
  .argument('<id>', 'document id (prop_…) or tracked index')
  .action(cmdJobs);

const image = program.command('image').description('Host images for use in HTML documents (Pro workspace)');
image
  .command('add')
  .description('Upload an image (PNG/JPEG/WebP/GIF) and get a hosted URL to use in <img src>')
  .argument('<file>', 'path to an image file')
  .option('--public', 'make the image publicly viewable (for public landing pages); default is workspace-only', false)
  .action(cmdImageAdd);

program
  .command('ls')
  .description('List documents this CLI has uploaded (locally tracked)')
  .action(cmdLs);

program
  .command('links')
  .description('List share links for a document')
  .argument('<doc>', 'document id, ls index, or id prefix')
  .action(cmdLinks);

const link = program.command('link').description('Manage share links');
link
  .command('add')
  .description('Create an additional share link for a document')
  .argument('<doc>', 'document id, ls index, or id prefix')
  .option('--alias <name>', 'a label for the link')
  .option('-a, --access <mode>', accessHelp, 'public')
  .option('-d, --domains <list>', 'comma-separated allowed email domains (for --access org)')
  .option('-p, --passcode <code>', 'passcode (for --access passcode, or org fallback)')
  .option('--download', 'allow recipients to download the file', false)
  .action(cmdLinkAdd);
link
  .command('rm')
  .description('Delete a share link')
  .argument('<doc>', 'document id, ls index, or id prefix')
  .argument('<linkId>', 'the link id to delete')
  .action(cmdLinkRm);

program
  .command('claim')
  .description('Claim locally-tracked anonymous uploads into your logged-in account (extends links to 7 days)')
  .argument('[doc]', 'a specific document (id/index/prefix); omit to claim all tracked')
  .action(cmdClaim);

program
  .command('stats')
  .description('Show analytics for a document (visitors, dwell, recent activity)')
  .argument('<doc>', 'document id, ls index, or id prefix')
  .action(cmdStats);

program
  .command('open')
  .description('Open a document dashboard in the browser')
  .argument('<doc>', 'document id, ls index, or id prefix')
  .action(cmdOpen);

program
  .command('rm')
  .description('Delete a document and all its links/stats on the server')
  .argument('<doc>', 'document id, ls index, or id prefix')
  .option('-y, --yes', 'skip confirmation', false)
  .action(cmdRm);

const tokenCmd = program.command('token').description('Manage API tokens (headless auth)');
tokenCmd
  .command('create')
  .description('Create an API token (requires login; secret shown once)')
  .option('-n, --name <name>', 'token label')
  .action(cmdTokenCreate);
tokenCmd.command('ls').description('List active API tokens').action(cmdTokenLs);
tokenCmd
  .command('rm')
  .description('Revoke an API token on the server')
  .argument('<id>', 'token id (tok_…)')
  .action(cmdTokenRm);

// ── 문서함(folder) — 테넌트 워크스페이스(서브도메인/커스텀도메인) 전용 ──
const folder = program.command('folder').description('Manage document folders (tenant workspace)');
folder.command('ls').description('List folders you can access (with your role)').action(cmdFolderLs);
folder
  .command('create')
  .description('Create a folder')
  .argument('<code>', 'unique folder key (e.g. acme-proposal)')
  .option('-n, --name <name>', 'display name (defaults to code)')
  .option('--private', 'restrict to explicit members (default: whole workspace can view)', false)
  .action(cmdFolderCreate);
folder
  .command('rename')
  .description('Rename a folder')
  .argument('<folder>', 'folder id or code')
  .argument('<name>', 'new display name')
  .action(cmdFolderRename);
folder
  .command('rm')
  .description('Delete a folder (documents inside are preserved, unfiled)')
  .argument('<folder>', 'folder id or code')
  .option('-y, --yes', 'skip confirmation', false)
  .action(cmdFolderRm);
folder
  .command('docs')
  .description('List documents in a folder')
  .argument('<folder>', 'folder id or code')
  .action(cmdFolderDocs);
folder
  .command('members')
  .description('List folder members')
  .argument('<folder>', 'folder id or code')
  .action(cmdFolderMembers);
folder
  .command('add-member')
  .description('Invite a member by email (ADMIN only)')
  .argument('<folder>', 'folder id or code')
  .argument('<email>', 'invitee email')
  .option('-r, --role <role>', 'admin | editor | viewer', 'viewer')
  .action(cmdFolderAddMember);
folder
  .command('rm-member')
  .description('Remove a folder member (ADMIN only)')
  .argument('<folder>', 'folder id or code')
  .argument('<memberId>', 'member id (from "folder members")')
  .action(cmdFolderRmMember);

// ── 워크스페이스(org) 멤버·초대 관리 — 테넌트 워크스페이스, ADMIN 이상 ──
const org = program.command('org').description('Manage workspace members and invitations (tenant workspace, ADMIN+)');
org.command('ls').description('List workspaces you belong to, with your role').action(cmdOrgLs);
org.command('members').description('List workspace members and their org roles').action(cmdOrgMembers);
org
  .command('invite')
  .description('Invite someone to the workspace by email (they join on sign-in)')
  .argument('<email>', 'invitee email')
  .option('-r, --role <role>', 'admin | member (you cannot grant a role above your own)', 'member')
  .action(cmdOrgInvite);
org.command('invitations').description('List pending invitations').action(cmdOrgInvitations);
org
  .command('revoke-invite')
  .description('Cancel a pending invitation')
  .argument('<invitationId>', 'invitation id (from "org invitations")')
  .action(cmdOrgRevokeInvite);
org
  .command('set-role')
  .description('Change a member’s org role (OWNER changes require OWNER)')
  .argument('<memberId>', 'member id (from "org members")')
  .argument('<role>', 'owner | admin | member')
  .action(cmdOrgSetRole);
org
  .command('rm-member')
  .description('Remove a member from the workspace')
  .argument('<memberId>', 'member id (from "org members")')
  .action(cmdOrgRmMember);
org.command('docs').description('List all documents in the workspace (incl. unfiled / orphaned)').action(cmdOrgDocs);
org
  .command('audit')
  .description('Show recent admin actions (member/folder/document changes)')
  .option('-n, --limit <n>', 'max entries (1–500, default 100)')
  .action(cmdOrgAudit);

program
  .command('config')
  .description('Show config, or set the API base URL')
  .option('--api-base <url>', 'set the API base URL (default https://cloudbtl.com)')
  .action(cmdConfig);

async function main(): Promise<void> {
  try {
    await program.parseAsync(process.argv);
  } catch (e) {
    if (e instanceof ApiClientError) {
      console.error(err(`✗ ${e.message}`) + (e.status ? ` (HTTP ${e.status})` : ''));
      if (e.status === 401) console.error(err('  Session expired or missing — run "cloudbtl login".'));
    } else if (e instanceof Error) {
      console.error(err(`✗ ${e.message}`));
    } else {
      console.error(err('✗ Unexpected error'), e);
    }
    process.exitCode = 1;
  }
}

void main();
