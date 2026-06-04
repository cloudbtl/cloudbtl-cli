import { basename, extname } from 'node:path';
import { readFile } from 'node:fs/promises';
import type {
  ApiError,
  CreateProposalResponse,
  LinkResponse,
  ProposalSummaryResponse,
} from './types.js';

export class ApiClientError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface AccessConfig {
  accessMode: 'public' | 'passcode' | 'org';
  allowedDomains?: string;
  accessCode?: string;
  allowDownload?: boolean;
}

function mimeFor(file: string): string {
  const ext = extname(file).toLowerCase();
  if (ext === '.pdf') return 'application/pdf';
  if (ext === '.html' || ext === '.htm') return 'text/html';
  return 'application/octet-stream';
}

function errorMessage(data: unknown, status: number): string {
  if (data && typeof data === 'object') {
    const e = data as ApiError;
    if (typeof e.error === 'string') return e.error;
    if (Array.isArray(e.message)) return e.message.join(', ');
    if (typeof e.message === 'string') return e.message;
  }
  return `Request failed (HTTP ${status})`;
}

export class Api {
  constructor(private readonly base: string) {}

  // The backend's same-origin guard compares Origin/Referer host to PUBLIC_BASE_URL,
  // so a first-party CLI must present a matching Origin on mutating requests.
  private headers(extra?: Record<string, string>): Record<string, string> {
    return { Origin: this.base, Accept: 'application/json', ...extra };
  }

  private async parse<T>(res: Response): Promise<T> {
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new ApiClientError(res.status, errorMessage(data, res.status));
    return data as T;
  }

  async upload(filePath: string, title: string | undefined, access: AccessConfig): Promise<CreateProposalResponse> {
    const buf = await readFile(filePath);
    const form = new FormData();
    form.append('pdf', new Blob([buf], { type: mimeFor(filePath) }), basename(filePath));
    if (title) form.append('title', title);
    form.append('accessMode', access.accessMode);
    if (access.accessMode === 'org' && access.allowedDomains) form.append('allowedDomains', access.allowedDomains);
    if (access.accessCode) form.append('accessCode', access.accessCode);
    if (access.allowDownload) form.append('allowDownload', 'true');
    const res = await fetch(`${this.base}/api/proposals`, {
      method: 'POST',
      body: form,
      headers: this.headers(),
    });
    return this.parse<CreateProposalResponse>(res);
  }

  async summary(proposalId: string, ownerKey: string): Promise<ProposalSummaryResponse> {
    const res = await fetch(
      `${this.base}/api/proposals/${proposalId}/summary?key=${encodeURIComponent(ownerKey)}`,
      { headers: this.headers() },
    );
    return this.parse<ProposalSummaryResponse>(res);
  }

  async createLink(
    proposalId: string,
    ownerKey: string,
    body: { alias?: string } & AccessConfig,
  ): Promise<LinkResponse> {
    const res = await fetch(
      `${this.base}/api/proposals/${proposalId}/links?key=${encodeURIComponent(ownerKey)}`,
      { method: 'POST', headers: this.headers({ 'Content-Type': 'application/json' }), body: JSON.stringify(body) },
    );
    return this.parse<LinkResponse>(res);
  }

  async deleteLink(proposalId: string, linkId: string, ownerKey: string): Promise<void> {
    const res = await fetch(
      `${this.base}/api/proposals/${proposalId}/links/${linkId}?key=${encodeURIComponent(ownerKey)}`,
      { method: 'DELETE', headers: this.headers() },
    );
    await this.parse<{ ok: true }>(res);
  }

  async deleteProposal(proposalId: string, ownerKey: string): Promise<void> {
    const res = await fetch(`${this.base}/api/proposals/${proposalId}?key=${encodeURIComponent(ownerKey)}`, {
      method: 'DELETE',
      headers: this.headers(),
    });
    await this.parse<{ ok: true }>(res);
  }
}
