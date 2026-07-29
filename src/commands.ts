import { spawn } from 'node:child_process';
import { access as fsAccess } from 'node:fs/promises';
import readline from 'node:readline';
import { Api, type AccessConfig } from './api.js';
import {
  type CliConfig,
  DEFAULT_GOOGLE_CLIENT_ID,
  configFilePath,
  forgetProposal,
  loadConfig,
  rememberProposal,
  resolveProposal,
  saveConfig,
  setSession,
  setToken,
} from './config.js';
import { googleLogin } from './google-login.js';
import { accessLabel, bold, dim, err, fmtDate, fmtMs, ok, table, warn } from './format.js';

export interface AccessOpts {
  access?: string;
  domains?: string;
  passcode?: string;
  download?: boolean;
}

interface DocRef {
  id: string;
  ownerKey: string;
  title: string;
  dashboardUrl: string;
}

function apiFor(config: CliConfig): Api {
  // 우선순위: env CLOUDBTL_TOKEN > 저장된 API 토큰 > 세션 쿠키.
  const token = process.env.CLOUDBTL_TOKEN || config.token?.value;
  return new Api(config.apiBase, config.session?.cookie, token);
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

/** Source of documents: the logged-in account (server) when a session exists, else the local registry. */
async function listDocs(config: CliConfig, api: Api): Promise<DocRef[]> {
  if (config.session) {
    const { proposals } = await api.myProposals();
    return proposals.map((p) => ({ id: p.id, ownerKey: '', title: p.title, dashboardUrl: p.dashboardUrl }));
  }
  return config.proposals.map((p) => ({
    id: p.id,
    ownerKey: p.ownerKey,
    title: p.title,
    dashboardUrl: p.dashboardUrl,
  }));
}

function pickDoc(list: DocRef[], ref: string): DocRef {
  if (/^\d+$/.test(ref)) {
    const hit = list[Number(ref) - 1];
    if (!hit) throw new Error(`No document at index ${ref}. Run "cloudbtl ls".`);
    return hit;
  }
  const exact = list.find((d) => d.id === ref);
  if (exact) return exact;
  const matches = list.filter((d) => d.id.startsWith(ref));
  if (matches.length === 1) return matches[0]!;
  if (matches.length > 1) throw new Error(`"${ref}" is ambiguous; matches ${matches.length} documents.`);
  throw new Error(`"${ref}" is not a known document. Run "cloudbtl ls".`);
}

async function resolveDoc(config: CliConfig, api: Api, ref: string): Promise<DocRef> {
  return pickDoc(await listDocs(config, api), ref);
}

// ---- auth ----

function promptHidden(query: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const rlAny = rl as unknown as { _writeToOutput: (s: string) => void; output: NodeJS.WriteStream };
    rlAny._writeToOutput = (str: string) => {
      if (str.includes(query) || str === '\n' || str === '\r\n') rlAny.output.write(str);
    };
    rl.question(query, (value) => {
      rl.close();
      process.stdout.write('\n');
      resolve(value);
    });
  });
}

function promptLine(query: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(query, (value) => {
      rl.close();
      resolve(value.trim());
    });
  });
}

export async function cmdLogin(opts: {
  basic?: boolean;
  email?: string;
  password?: string;
  token?: string;
}): Promise<void> {
  const config = await loadConfig();
  const api = new Api(config.apiBase);

  // API 토큰 로그인 — 헤드리스(에이전트/CI). 검증 후 저장, 세션은 비운다.
  if (opts.token) {
    const { user: u } = await new Api(config.apiBase, undefined, opts.token).me();
    if (!u) throw new Error('Token rejected by the server.');
    await setSession(undefined);
    await setToken({ value: opts.token, email: u.email, savedAt: new Date().toISOString() });
    console.log(ok('✓ Token saved for ') + bold(u.email) + dim(` (${config.apiBase})`));
    return;
  }

  let user: { email: string; name: string };
  let cookie: string;

  // Google sign-in is the default; email+password is opt-in via --basic (or by passing -e/-p).
  const useBasic = Boolean(opts.basic || opts.email || opts.password);
  if (useBasic) {
    const email = opts.email || (await promptLine('Email: '));
    const password = opts.password || process.env.CLOUDBTL_PASSWORD || (await promptHidden('Password: '));
    if (!email || !password) throw new Error('Email and password are required.');
    ({ user, cookie } = await api.login(email, password));
  } else {
    const clientId = config.googleClientId || process.env.CLOUDBTL_GOOGLE_CLIENT_ID || DEFAULT_GOOGLE_CLIENT_ID;
    ({ user, cookie } = await googleLogin(api, clientId));
  }

  await setToken(undefined); // 브라우저 로그인 = 세션 우선 — 남은 토큰 설정 제거
  await setSession({ cookie, email: user.email, savedAt: new Date().toISOString() });
  console.log(ok('✓ Logged in as ') + bold(user.email) + dim(` (${config.apiBase})`));
}

export async function cmdLogout(): Promise<void> {
  const config = await loadConfig();
  if (!config.session && !config.token) {
    console.log(dim('Not logged in.'));
    return;
  }
  if (config.session) await apiFor(config).logout();
  await setSession(undefined);
  await setToken(undefined); // 로컬 제거만 — 서버측 폐기는 "cloudbtl token rm"
  console.log(ok('✓ Logged out.'));
}

export async function cmdWhoami(): Promise<void> {
  const config = await loadConfig();
  const viaToken = Boolean(process.env.CLOUDBTL_TOKEN || config.token);
  if (!config.session && !viaToken) {
    console.log(dim('Not logged in. Run "cloudbtl login" (or "cloudbtl login --token <cbtl_…>").'));
    return;
  }
  const { user } = await apiFor(config).me();
  if (!user) {
    console.log(warn(viaToken ? 'Token invalid or revoked.' : 'Session expired. Run "cloudbtl login" again.'));
    return;
  }
  console.log(`${bold(user.email)} ${dim(`(${user.name})`)} · ${config.apiBase}${viaToken ? dim(' · api-token') : ''}`);
}

// ---- API tokens (헤드리스 인증) ----

export async function cmdTokenCreate(opts: { name?: string }): Promise<void> {
  const config = await loadConfig();
  const name = opts.name?.trim() || `cli-${new Date().toISOString().slice(0, 10)}`;
  const { token, secret } = await apiFor(config).createToken(name);
  console.log(ok('✓ Token created: ') + bold(token.name) + dim(` (${token.id})`));
  console.log('\n  ' + bold(secret) + '\n');
  console.log(warn('  Shown once — store it now.'));
  console.log(dim('  Use: cloudbtl login --token <secret>   or   CLOUDBTL_TOKEN env var'));
}

export async function cmdTokenLs(): Promise<void> {
  const config = await loadConfig();
  const { tokens } = await apiFor(config).listTokens();
  if (tokens.length === 0) {
    console.log(dim('No API tokens. Create one with "cloudbtl token create".'));
    return;
  }
  for (const t of tokens) {
    console.log(`${bold(t.name)} ${dim(t.id)} · created ${t.createdAt.slice(0, 10)} · last used ${t.lastUsedAt ? t.lastUsedAt.slice(0, 10) : 'never'}`);
  }
}

export async function cmdTokenRm(id: string): Promise<void> {
  const config = await loadConfig();
  await apiFor(config).revokeToken(id);
  if (config.token) await setToken(undefined);
  console.log(ok('✓ Token revoked.'));
}

// ---- documents ----

export async function cmdUpload(file: string, opts: AccessOpts & { title?: string; project?: string }): Promise<void> {
  await fsAccess(file).catch(() => {
    throw new Error(`File not found: ${file}`);
  });
  const config = await loadConfig();
  const api = apiFor(config);
  const access = buildAccess(opts);
  const { proposal } = await api.upload(file, opts.title, access, opts.project);
  // Track locally too (works whether or not you're logged in; the ownerKey is the anonymous fallback).
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
  const api = apiFor(config);
  if (config.session) {
    const { proposals } = await api.myProposals();
    if (proposals.length === 0) {
      console.log(dim('No documents in your account yet.'));
      return;
    }
    const rows = proposals.map((p, i) => [
      String(i + 1),
      p.id,
      p.title.length > 36 ? p.title.slice(0, 35) + '…' : p.title,
      String(p.links),
      String(p.visitors),
      String(p.opens),
    ]);
    console.log(table(['#', 'ID', 'TITLE', 'LINKS', 'VISITORS', 'OPENS'], rows));
    console.log(dim(`\n${proposals.length} document(s) · ${config.session.email} · ${config.apiBase}`));
    return;
  }
  if (config.proposals.length === 0) {
    console.log(dim('No tracked documents. Upload one, or "cloudbtl login" to see your account.'));
    return;
  }
  const rows = config.proposals.map((p, i) => [
    String(i + 1),
    p.id,
    p.title.length > 40 ? p.title.slice(0, 39) + '…' : p.title,
    fmtDate(p.createdAt),
  ]);
  console.log(table(['#', 'ID', 'TITLE', 'CREATED'], rows));
  console.log(dim(`\n${config.proposals.length} document(s) · anonymous · ${config.apiBase}`));
}

export async function cmdLinks(ref: string): Promise<void> {
  const config = await loadConfig();
  const api = apiFor(config);
  const doc = await resolveDoc(config, api, ref);
  const { summary } = await api.summary(doc.id, doc.ownerKey);
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
  const api = apiFor(config);
  const doc = await resolveDoc(config, api, ref);
  const access = buildAccess(opts);
  const { link } = await api.createLink(doc.id, doc.ownerKey, { alias: opts.alias, ...access });
  console.log(ok('✓ Link created') + ` ${dim(link.id)}`);
  console.log(`  access: ${accessLabel(link.accessMode)}${link.allowedDomains ? dim(` [${link.allowedDomains}]`) : ''}`);
  console.log(`  share:  ${link.shareUrl}`);
}

export async function cmdLinkRm(ref: string, linkId: string): Promise<void> {
  const config = await loadConfig();
  const api = apiFor(config);
  const doc = await resolveDoc(config, api, ref);
  await api.deleteLink(doc.id, linkId, doc.ownerKey);
  console.log(ok('✓ Link deleted') + ` ${dim(linkId)}`);
}

export async function cmdStats(ref: string): Promise<void> {
  const config = await loadConfig();
  const api = apiFor(config);
  const doc = await resolveDoc(config, api, ref);
  const { proposal, summary } = await api.summary(doc.id, doc.ownerKey);
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
  const api = apiFor(config);
  const doc = await resolveDoc(config, api, ref);
  const url = doc.dashboardUrl;
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  spawn(cmd, [url], { stdio: 'ignore', detached: true, shell: process.platform === 'win32' }).unref();
  console.log(dim(`Opening ${url}`));
}

export async function cmdRm(ref: string, opts: { yes?: boolean }): Promise<void> {
  const config = await loadConfig();
  const api = apiFor(config);
  const doc = await resolveDoc(config, api, ref);
  if (!opts.yes) {
    throw new Error(`This deletes "${doc.title}" and all its links/stats on the server. Re-run with --yes to confirm.`);
  }
  await api.deleteProposal(doc.id, doc.ownerKey);
  await forgetProposal(doc.id);
  console.log(ok('✓ Deleted') + ` ${doc.title} ${dim(`(${doc.id})`)}`);
}

export async function cmdClaim(ref: string | undefined): Promise<void> {
  const config = await loadConfig();
  if (!config.session) throw new Error('Log in first with "cloudbtl login", then claim.');
  const api = apiFor(config);

  let targets = config.proposals.filter((p) => p.ownerKey);
  if (ref) {
    const one = resolveProposal(config, ref);
    targets = one.ownerKey ? [one] : [];
  }
  if (targets.length === 0) {
    console.log(dim('Nothing to claim — no locally-tracked documents with an owner key.'));
    return;
  }

  let done = 0;
  for (const p of targets) {
    try {
      await api.claim(p.id, p.ownerKey);
      done += 1;
      console.log(ok('✓ claimed') + ` ${p.title} ${dim(`(${p.id})`)}`);
    } catch (e) {
      console.log(err(`✗ ${p.id}: ${e instanceof Error ? e.message : 'failed'}`));
    }
  }
  console.log(dim(`\nClaimed ${done}/${targets.length} into ${config.session.email} — links extended to the 7-day tier.`));
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
  console.log(`account:   ${config.session ? config.session.email : dim('not logged in')}`);
  console.log(`tracked:   ${config.proposals.length} local document(s)`);
}
