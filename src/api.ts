import { basename, extname } from 'node:path';
import { readFile } from 'node:fs/promises';
import type {
  ApiError,
  AuthResponse,
  CreateProposalResponse,
  LinkResponse,
  MeResponse,
  MyProposalsResponse,
  ProposalSummaryResponse,
} from './types.js';

const SESSION_COOKIE = 'cloudbtl_session';

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
  if (ext === '.md' || ext === '.markdown') return 'text/markdown';
  if (ext === '.pptx') return 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
  return 'application/octet-stream';
}

export interface Folder {
  id: string;
  code: string;
  name: string;
  visibility: 'org' | 'private';
  myRole: 'ADMIN' | 'EDITOR' | 'VIEWER';
  externalRef: string | null;
  externalRefKind: string | null;
  docCount?: number;
}
export interface FolderMember {
  id: string;
  email: string | null;
  userId: string | null;
  role: 'ADMIN' | 'EDITOR' | 'VIEWER';
}
export interface FolderDoc {
  id: string;
  title: string;
  kind: 'html' | 'md' | 'pdf' | 'pptx';
  createdAt: string;
}

function extractSessionCookie(res: Response): string | null {
  const cookies =
    typeof res.headers.getSetCookie === 'function'
      ? res.headers.getSetCookie()
      : [res.headers.get('set-cookie') ?? ''];
  for (const c of cookies) {
    const m = c.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`));
    if (m && m[1]) return m[1];
  }
  return null;
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
  constructor(
    private readonly base: string,
    private readonly sessionCookie?: string,
    private readonly apiToken?: string,
  ) {}

  // The backend's same-origin guard compares Origin/Referer host to PUBLIC_BASE_URL,
  // so a first-party CLI must present a matching Origin on mutating requests.
  private headers(extra?: Record<string, string>): Record<string, string> {
    const h: Record<string, string> = { Origin: this.base, Accept: 'application/json', ...extra };
    // API 토큰(cbtl_…)이 있으면 Bearer 우선 — 헤드리스(에이전트/CI) 경로.
    if (this.apiToken) h['Authorization'] = `Bearer ${this.apiToken}`;
    else if (this.sessionCookie) h['Cookie'] = `${SESSION_COOKIE}=${this.sessionCookie}`;
    return h;
  }

  /** Logs in with email+password and returns the user plus the session cookie value to persist. */
  async login(email: string, password: string): Promise<{ user: AuthResponse['user']; cookie: string }> {
    const res = await fetch(`${this.base}/api/auth/login`, {
      method: 'POST',
      headers: this.headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ email, password }),
    });
    const data = await this.parse<AuthResponse>(res);
    const cookie = extractSessionCookie(res);
    if (!cookie) throw new ApiClientError(res.status, 'Login succeeded but no session cookie was returned.');
    return { user: data.user, cookie };
  }

  /** Exchanges a Google ID token (credential) for a cloudbtl session via the existing /auth/google. */
  async loginWithGoogle(credential: string): Promise<{ user: AuthResponse['user']; cookie: string }> {
    const res = await fetch(`${this.base}/api/auth/google`, {
      method: 'POST',
      headers: this.headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ credential }),
    });
    const data = await this.parse<AuthResponse>(res);
    const cookie = extractSessionCookie(res);
    if (!cookie) throw new ApiClientError(res.status, 'Google sign-in succeeded but no session cookie was returned.');
    return { user: data.user, cookie };
  }

  async logout(): Promise<void> {
    await fetch(`${this.base}/api/auth/logout`, { method: 'POST', headers: this.headers() }).catch(() => {});
  }

  async createToken(name: string): Promise<{ ok: true; token: { id: string; name: string; createdAt: string }; secret: string }> {
    return this.parse(
      await fetch(`${this.base}/api/auth/tokens`, {
        method: 'POST',
        headers: this.headers({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ name }),
      }),
    );
  }

  async listTokens(): Promise<{ ok: true; tokens: { id: string; name: string; createdAt: string; lastUsedAt: string | null }[] }> {
    return this.parse(await fetch(`${this.base}/api/auth/tokens`, { headers: this.headers() }));
  }

  async revokeToken(id: string): Promise<{ ok: true }> {
    return this.parse(
      await fetch(`${this.base}/api/auth/tokens/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: this.headers(),
      }),
    );
  }

  async me(): Promise<MeResponse> {
    return this.parse<MeResponse>(await fetch(`${this.base}/api/me`, { headers: this.headers() }));
  }

  async myProposals(): Promise<MyProposalsResponse> {
    return this.parse<MyProposalsResponse>(
      await fetch(`${this.base}/api/me/proposals`, { headers: this.headers() }),
    );
  }

  private async parse<T>(res: Response): Promise<T> {
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new ApiClientError(res.status, errorMessage(data, res.status));
    return data as T;
  }

  async upload(filePath: string, title: string | undefined, access: AccessConfig, projectCode?: string): Promise<CreateProposalResponse> {
    const buf = await readFile(filePath);
    const form = new FormData();
    form.append('pdf', new Blob([buf], { type: mimeFor(filePath) }), basename(filePath));
    if (title) form.append('title', title);
    if (projectCode) form.append('projectCode', projectCode);
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

  /** 이미지 에셋 업로드(Pro+ 워크스페이스) → 공개 hosted URL. base64 인라인 대체. */
  async uploadAsset(
    filePath: string,
    opts?: { public?: boolean },
  ): Promise<{ ok: true; id: string; url: string; contentType: string; size: number; visibility: string }> {
    const buf = await readFile(filePath);
    const form = new FormData();
    // 서버가 매직바이트로 타입 확정 — 클라 mimetype 은 무시되므로 octet-stream 이어도 무방.
    form.append('file', new Blob([buf], { type: mimeFor(filePath) }), basename(filePath));
    // 기본 private(서버 fail-closed). --public 일 때만 공개.
    if (opts?.public) form.append('public', 'true');
    const res = await fetch(`${this.base}/api/assets`, { method: 'POST', body: form, headers: this.headers() });
    return this.parse(res);
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

  async claim(proposalId: string, ownerKey: string): Promise<void> {
    const res = await fetch(`${this.base}/api/proposals/${proposalId}/claim?key=${encodeURIComponent(ownerKey)}`, {
      method: 'POST',
      headers: this.headers(),
    });
    await this.parse<{ ok: true }>(res);
  }

  async deleteProposal(proposalId: string, ownerKey: string): Promise<void> {
    const res = await fetch(`${this.base}/api/proposals/${proposalId}?key=${encodeURIComponent(ownerKey)}`, {
      method: 'DELETE',
      headers: this.headers(),
    });
    await this.parse<{ ok: true }>(res);
  }

  // ── 문서함(folder) — 테넌트(서브도메인/커스텀도메인) 워크스페이스 전용 ──
  async listFolders(): Promise<{ ok: true; projects: Folder[] }> {
    return this.parse(await fetch(`${this.base}/api/projects`, { headers: this.headers() }));
  }

  async createFolder(code: string, name?: string): Promise<{ ok: true; project: { id: string; code: string; name: string } }> {
    return this.parse(
      await fetch(`${this.base}/api/projects`, {
        method: 'POST',
        headers: this.headers({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ code, name }),
      }),
    );
  }

  async updateFolder(id: string, patch: { name?: string; visibility?: 'org' | 'private' }): Promise<{ ok: true; project: unknown }> {
    return this.parse(
      await fetch(`${this.base}/api/projects/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: this.headers({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(patch),
      }),
    );
  }

  async deleteFolder(id: string): Promise<{ ok: true }> {
    return this.parse(
      await fetch(`${this.base}/api/projects/${encodeURIComponent(id)}`, { method: 'DELETE', headers: this.headers() }),
    );
  }

  async folderDocs(id: string): Promise<{ ok: true; proposals: FolderDoc[] }> {
    return this.parse(await fetch(`${this.base}/api/projects/${encodeURIComponent(id)}/proposals`, { headers: this.headers() }));
  }

  async listMembers(id: string): Promise<{ ok: true; members: FolderMember[] }> {
    return this.parse(await fetch(`${this.base}/api/projects/${encodeURIComponent(id)}/members`, { headers: this.headers() }));
  }

  async addMember(id: string, email: string, role: string): Promise<{ ok: true; member: FolderMember }> {
    return this.parse(
      await fetch(`${this.base}/api/projects/${encodeURIComponent(id)}/members`, {
        method: 'POST',
        headers: this.headers({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ email, role }),
      }),
    );
  }

  async removeMember(id: string, memberId: string): Promise<{ ok: true }> {
    return this.parse(
      await fetch(`${this.base}/api/projects/${encodeURIComponent(id)}/members/${encodeURIComponent(memberId)}`, {
        method: 'DELETE',
        headers: this.headers(),
      }),
    );
  }
}
