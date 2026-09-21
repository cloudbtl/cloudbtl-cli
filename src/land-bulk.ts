import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { appendFile, readFile, readdir, stat } from 'node:fs/promises';
import { basename, relative, resolve, sep } from 'node:path';

export const DIRECT_UPLOAD_THRESHOLD = 25 * 1024 * 1024;
export const MAX_MULTIPART_FILES = 50;
export const MAX_MULTIPART_BYTES = 25 * 1024 * 1024;

export interface LandCandidate {
  path: string;
  size: number;
  sha256: string;
  sourceRef: string;
  metadata: Record<string, unknown>;
}

export interface ManifestEntry {
  path: string;
  size: number;
  sha256: string;
  proposalId?: string;
  deduplicated?: boolean;
  status: 'landed' | 'deduplicated' | 'failed' | 'local_duplicate';
  error?: string;
  at: string;
}

function globRegex(glob: string): RegExp {
  let source = '^';
  const normalized = glob.replaceAll('\\', '/');
  for (let i = 0; i < normalized.length; i += 1) {
    const ch = normalized[i]!;
    if (ch === '*') {
      if (normalized[i + 1] === '*') {
        i += 1;
        if (normalized[i + 1] === '/') {
          i += 1;
          source += '(?:.*/)?';
        } else {
          source += '.*';
        }
      } else {
        source += '[^/]*';
      }
    } else if (ch === '?') {
      source += '[^/]';
    } else {
      source += ch.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
    }
  }
  return new RegExp(source + '$', 'i');
}

function matchesAny(path: string, patterns: string[]): boolean {
  const normalized = path.replaceAll(sep, '/');
  const name = basename(path);
  return patterns.some((pattern) => {
    const re = globRegex(pattern.trim());
    return re.test(normalized) || re.test(name);
  });
}

function splitPatterns(value?: string): string[] {
  return value?.split(',').map((v) => v.trim()).filter(Boolean) ?? [];
}

async function walk(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(
    entries
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(async (entry) => {
        const path = resolve(dir, entry.name);
        if (entry.isDirectory()) return walk(path);
        return entry.isFile() ? [path] : [];
      }),
  );
  return nested.flat();
}

export async function expandInputs(
  inputs: string[],
  options: { recursive?: boolean; include?: string; exclude?: string },
): Promise<string[]> {
  const include = splitPatterns(options.include);
  const exclude = splitPatterns(options.exclude);
  const files: string[] = [];
  for (const input of inputs) {
    const absolute = resolve(input);
    const info = await stat(absolute).catch(() => null);
    if (!info) throw new Error(`File not found: ${input}`);
    if (info.isDirectory()) {
      if (!options.recursive) throw new Error(`${input} is a directory; add --recursive.`);
      files.push(...(await walk(absolute)));
    } else if (info.isFile()) {
      files.push(absolute);
    }
  }
  return [...new Set(files)]
    .filter((path) => include.length === 0 || matchesAny(path, include))
    .filter((path) => exclude.length === 0 || !matchesAny(path, exclude))
    .sort();
}

export async function sha256(path: string): Promise<string> {
  return new Promise((resolveHash, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(path);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolveHash(hash.digest('hex')));
  });
}

export function sourceRefFor(path: string, root?: string): string {
  if (!root) return basename(path);
  const rel = relative(resolve(root), path);
  if (rel === '..' || rel.startsWith(`..${sep}`)) {
    throw new Error(`${path} is outside --ref-from-path root ${root}`);
  }
  return rel.replaceAll(sep, '/');
}

export function metadataFromPath(pattern: string | undefined, path: string): Record<string, string> {
  if (!pattern) return {};
  const names: string[] = [];
  const source = pattern.replace(/\{([A-Za-z][A-Za-z0-9_]*)\}/g, (_whole, name: string) => {
    names.push(name);
    return `(?<${name}>[^/]+?)`;
  });
  let match: RegExpMatchArray | null;
  try {
    match = path.replaceAll(sep, '/').match(new RegExp(source));
  } catch (error) {
    throw new Error(`Invalid --meta-from-path pattern: ${(error as Error).message}`);
  }
  if (!match?.groups) return {};
  return Object.fromEntries(names.map((name) => [name, match!.groups![name] ?? '']));
}

export async function readManifest(path?: string): Promise<ManifestEntry[]> {
  if (!path) return [];
  const text = await readFile(path, 'utf8').catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return '';
    throw error;
  });
  return text
    .split('\n')
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line) as ManifestEntry;
      } catch {
        throw new Error(`Invalid JSON in manifest ${path}:${index + 1}`);
      }
    });
}

export async function appendManifest(path: string | undefined, entry: ManifestEntry): Promise<void> {
  if (!path) return;
  await appendFile(path, JSON.stringify(entry) + '\n', { encoding: 'utf8', mode: 0o600 });
}

export function successfulManifestPaths(entries: ManifestEntry[]): Set<string> {
  return new Set(entries.filter((entry) => entry.status === 'landed' || entry.status === 'deduplicated').map((entry) => resolve(entry.path)));
}

export function successfulManifestHashes(entries: ManifestEntry[]): Set<string> {
  return new Set(entries.filter((entry) => entry.status === 'landed' || entry.status === 'deduplicated').map((entry) => entry.sha256));
}

export function makeBatchId(explicit?: string): string {
  return explicit?.trim() || `cli-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}-${randomUUID().slice(0, 8)}`;
}

export function multipartGroups(candidates: LandCandidate[]): LandCandidate[][] {
  const groups: LandCandidate[][] = [];
  let current: LandCandidate[] = [];
  let bytes = 0;
  for (const candidate of candidates) {
    if (candidate.size >= DIRECT_UPLOAD_THRESHOLD) continue;
    if (current.length && (current.length >= MAX_MULTIPART_FILES || bytes + candidate.size > MAX_MULTIPART_BYTES)) {
      groups.push(current);
      current = [];
      bytes = 0;
    }
    current.push(candidate);
    bytes += candidate.size;
  }
  if (current.length) groups.push(current);
  return groups;
}

export async function mapLimit<T, R>(items: T[], concurrency: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await fn(items[index]!, index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(Math.max(1, concurrency), items.length) }, () => worker()));
  return results;
}
