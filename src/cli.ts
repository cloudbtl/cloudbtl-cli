import { Command } from 'commander';
import { ApiClientError } from './api.js';
import { err } from './format.js';
import {
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
  .description('Log in to manage your whole account (email+password, or --google)')
  .option('-g, --google', 'sign in with Google in the browser', false)
  .option('-e, --email <email>', 'account email (otherwise prompted)')
  .option('-p, --password <password>', 'account password (otherwise prompted; or CLOUDBTL_PASSWORD)')
  .action(cmdLogin);

program.command('logout').description('Clear the saved session').action(cmdLogout);
program.command('whoami').description('Show the logged-in account').action(cmdWhoami);

program
  .command('upload')
  .description('Upload a PDF/HTML document and create its first share link')
  .argument('<file>', 'path to a .pdf or .html file')
  .option('-t, --title <title>', 'document title (defaults to the filename)')
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
