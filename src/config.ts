import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

export interface TrackedProposal {
  id: string;
  ownerKey: string;
  title: string;
  shareUrl: string;
  dashboardUrl: string;
  createdAt: string;
}

export interface Session {
  cookie: string;
  email: string;
  savedAt: string;
}

export interface CliConfig {
  apiBase: string;
  proposals: TrackedProposal[];
  session?: Session;
}

const DEFAULT_API_BASE = 'https://cloudbtl.com';

function configDir(): string {
  const xdg = process.env.XDG_CONFIG_HOME;
  return join(xdg && xdg.trim() ? xdg : join(homedir(), '.config'), 'cloudbtl');
}

function configPath(): string {
  return join(configDir(), 'config.json');
}

export async function loadConfig(): Promise<CliConfig> {
  try {
    const raw = await readFile(configPath(), 'utf8');
    const parsed = JSON.parse(raw) as Partial<CliConfig>;
    return {
      apiBase: (parsed.apiBase || DEFAULT_API_BASE).replace(/\/+$/, ''),
      proposals: Array.isArray(parsed.proposals) ? parsed.proposals : [],
      session: parsed.session,
    };
  } catch {
    return { apiBase: DEFAULT_API_BASE, proposals: [] };
  }
}

export async function saveConfig(config: CliConfig): Promise<void> {
  await mkdir(configDir(), { recursive: true });
  await writeFile(configPath(), JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
}

export function configFilePath(): string {
  return configPath();
}

export async function setSession(session: Session | undefined): Promise<void> {
  const config = await loadConfig();
  config.session = session;
  await saveConfig(config);
}

export async function rememberProposal(p: TrackedProposal): Promise<void> {
  const config = await loadConfig();
  const others = config.proposals.filter((x) => x.id !== p.id);
  config.proposals = [p, ...others];
  await saveConfig(config);
}

export async function forgetProposal(id: string): Promise<void> {
  const config = await loadConfig();
  config.proposals = config.proposals.filter((x) => x.id !== id);
  await saveConfig(config);
}

/**
 * Resolve a user-supplied reference to a tracked proposal.
 * Accepts a full proposal id (`prop_…`), a 1-based index from `ls`, or a unique id prefix.
 */
export function resolveProposal(config: CliConfig, ref: string): TrackedProposal {
  if (/^\d+$/.test(ref)) {
    const idx = Number(ref) - 1;
    const hit = config.proposals[idx];
    if (!hit) throw new Error(`No tracked document at index ${ref}. Run "cloudbtl ls".`);
    return hit;
  }
  const exact = config.proposals.find((p) => p.id === ref);
  if (exact) return exact;
  const matches = config.proposals.filter((p) => p.id.startsWith(ref));
  if (matches.length === 1) return matches[0]!;
  if (matches.length > 1) throw new Error(`"${ref}" is ambiguous; matches ${matches.length} documents.`);
  throw new Error(`"${ref}" is not a tracked document. Run "cloudbtl ls" to see tracked ids.`);
}
