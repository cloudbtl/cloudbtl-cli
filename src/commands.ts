import { spawn } from 'node:child_process';
import { access as fsAccess } from 'node:fs/promises';
import { Api, type AccessConfig } from './api.js';
import {
  configFilePath,
  forgetProposal,
  loadConfig,
  rememberProposal,
  resolveProposal,
  saveConfig,
} from './config.js';
import { accessLabel, bold, dim, fmtDate, fmtMs, ok, table, warn } from './format.js';

export interface AccessOpts {
  access?: string;
  domains?: string;
  passcode?: string;
  download?: boolean;
}

function buildAccess(opts: AccessOpts): AccessConfig {
  const mode = (opts.access ?? 'public') as AccessConfig['accessMode'];
  if (!['public', 'passcode', 'org'].includes(mode)) {
    throw new Error(`--access must be one of: public, passcode, org (got "${mode}")`);
  }
  if (mode === 'org' && !opts.domains?.trim()) {
    throw new Error('Organization links need --domains (e.g. --domains clientcorp.com,sweetspot.co.kr)');
  }
  if (mode === 'passcode' && (!opts.passcode || opts.passcode.length < 6)) {
    throw new Error('Passcode links need --passcode with at least 6 characters.');
  }
  if (mode === 'org' && opts.passcode && opts.passcode.length < 6) {
    throw new Error('The --passcode fallback needs at least 6 characters.');
  }
  return {
    accessMode: mode,
    allowedDomains: mode === 'org' ? opts.domains : undefined,
    accessCode: opts.passcode,
    allowDownload: Boolean(opts.download),
  };
}

export async function cmdUpload(file: string, opts: AccessOpts & { title?: string }): Promise<void> {
  await fsAccess(file).catch(() => {
    throw new Error(`File not found: ${file}`);
  });
  const config = await loadConfig();
  const api = new Api(config.apiBase);
  const access = buildAccess(opts);
  const { proposal } = await api.upload(file, opts.title, access);
  await rememberProposal({
    id: proposal.id,
    ownerKey: new URL(proposal.dashboardUrl).searchParams.get('key') ?? '',
    title: proposal.title,
    shareUrl: proposal.shareUrl,
    dashboardUrl: proposal.dashboardUrl,
    createdAt: new Date().toISOString(),
  });
  console.log(ok('✓ Uploaded') + ` ${bold(proposal.title)} ${dim(`(${proposal.id})`)}`);
  console.log(`  access:    ${accessLabel(proposal.accessMode)}${proposal.allowedDomains ? dim(` [${proposal.allowedDomains}]`) : ''}`);
  console.log(`  share:     ${proposal.shareUrl}`);
  console.log(`  dashboard: ${proposal.dashboardUrl}`);
}

export async function cmdLs(): Promise<void> {
  const config = await loadConfig();
  if (config.proposals.length === 0) {
    console.log(dim('No tracked documents yet. Upload one with "cloudbtl upload <file>".'));
    return;
  }
  const rows = config.proposals.map((p, i) => [
    String(i + 1),
    p.id,
    p.title.length > 40 ? p.title.slice(0, 39) + '…' : p.title,
    fmtDate(p.createdAt),
  ]);
  console.log(table(['#', 'ID', 'TITLE', 'CREATED'], rows));
  console.log(dim(`\n${config.proposals.length} document(s) · ${config.apiBase}`));
}

export async function cmdLinks(ref: string): Promise<void> {
  const config = await loadConfig();
  const p = resolveProposal(config, ref);
  const api = new Api(config.apiBase);
  const { summary } = await api.summary(p.id, p.ownerKey);
  if (summary.links.length === 0) {
    console.log(dim('This document has no share links.'));
    return;
  }
  const rows = summary.links.map((l) => [
    l.id,
    l.alias,
    accessLabel(l.accessMode) + (l.disabled ? warn(' (off)') : ''),
    String(l.visitors),
    String(l.sessions),
    l.shareUrl,
  ]);
  console.log(table(['LINK ID', 'ALIAS', 'ACCESS', 'VISITORS', 'OPENS', 'URL'], rows));
}

export async function cmdLinkAdd(ref: string, opts: AccessOpts & { alias?: string }): Promise<void> {
  const config = await loadConfig();
  const p = resolveProposal(config, ref);
  const api = new Api(config.apiBase);
  const access = buildAccess(opts);
  const { link } = await api.createLink(p.id, p.ownerKey, { alias: opts.alias, ...access });
  console.log(ok('✓ Link created') + ` ${dim(link.id)}`);
  console.log(`  access: ${accessLabel(link.accessMode)}${link.allowedDomains ? dim(` [${link.allowedDomains}]`) : ''}`);
  console.log(`  share:  ${link.shareUrl}`);
}

export async function cmdLinkRm(ref: string, linkId: string): Promise<void> {
  const config = await loadConfig();
  const p = resolveProposal(config, ref);
  const api = new Api(config.apiBase);
  await api.deleteLink(p.id, linkId, p.ownerKey);
  console.log(ok('✓ Link deleted') + ` ${dim(linkId)}`);
}

export async function cmdStats(ref: string): Promise<void> {
  const config = await loadConfig();
  const p = resolveProposal(config, ref);
  const api = new Api(config.apiBase);
  const { proposal, summary } = await api.summary(p.id, p.ownerKey);
  console.log(bold(proposal.title) + ` ${dim(`(${proposal.id})`)}`);
  console.log(
    `${summary.visitors} visitors · ${summary.sessions} opens · ${summary.events} events · ${summary.links.length} links\n`,
  );

  if (summary.pages.length) {
    console.log(bold('Per-page dwell'));
    const rows = summary.pages.map((pg) => [
      String(pg.pageNumber),
      String(pg.views),
      fmtMs(pg.totalMs),
      fmtMs(pg.avgMs),
    ]);
    console.log(table(['PAGE', 'VIEWS', 'TOTAL', 'AVG'], rows) + '\n');
  }

  if (summary.recentEvents.length) {
    console.log(bold('Recent activity'));
    const rows = summary.recentEvents.slice(0, 15).map((e) => [
      fmtDate(e.createdAt),
      e.eventType,
      e.pageNumber != null ? `p${e.pageNumber}` : '',
      e.target ?? '',
      e.linkAlias ?? '',
    ]);
    console.log(table(['WHEN', 'EVENT', 'PAGE', 'TARGET', 'LINK'], rows));
  }
}

export async function cmdOpen(ref: string): Promise<void> {
  const config = await loadConfig();
  const p = resolveProposal(config, ref);
  const url = p.dashboardUrl;
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  spawn(cmd, [url], { stdio: 'ignore', detached: true, shell: process.platform === 'win32' }).unref();
  console.log(dim(`Opening ${url}`));
}

export async function cmdRm(ref: string, opts: { yes?: boolean }): Promise<void> {
  const config = await loadConfig();
  const p = resolveProposal(config, ref);
  if (!opts.yes) {
    throw new Error(`This deletes "${p.title}" and all its links/stats on the server. Re-run with --yes to confirm.`);
  }
  const api = new Api(config.apiBase);
  await api.deleteProposal(p.id, p.ownerKey);
  await forgetProposal(p.id);
  console.log(ok('✓ Deleted') + ` ${p.title} ${dim(`(${p.id})`)}`);
}

export async function cmdConfig(opts: { apiBase?: string }): Promise<void> {
  const config = await loadConfig();
  if (opts.apiBase) {
    config.apiBase = opts.apiBase.replace(/\/+$/, '');
    await saveConfig(config);
    console.log(ok('✓ apiBase set to ') + config.apiBase);
    return;
  }
  console.log(`apiBase:   ${config.apiBase}`);
  console.log(`config:    ${configFilePath()}`);
  console.log(`tracked:   ${config.proposals.length} document(s)`);
}
