import { Command } from 'commander';
import { ApiClientError } from './api.js';
import { err } from './format.js';
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
  cmdWhoami,
  cmdTokenCreate,
  cmdTokenLs,
  cmdTokenRm,
} from './commands.js';

const program = new Command();

program
  .name('cloudbtl')
  .description('Command-line client for cloudbtl.com — upload documents, manage share links, read analytics.')
  .version('0.1.0');

const accessHelp =
  'access mode: public | passcode | org (org needs --domains; passcode needs --passcode)';

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
