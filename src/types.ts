// API response shapes — mirrored from cloudbtl-site's @cloudbtl/shared.
// Kept minimal: only the fields this CLI consumes.

export type AccessMode = 'public' | 'passcode' | 'org';

export interface ApiError {
  ok: false;
  error?: string;
  message?: string | string[];
}

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  emailVerified: boolean;
}

export interface AuthResponse {
  ok: true;
  user: AuthUser;
}

export interface MeResponse {
  ok: true;
  user: AuthUser | null;
}

export interface MyProposalsResponse {
  ok: true;
  proposals: {
    id: string;
    title: string;
    originalFilename: string;
    fileSize: number;
    createdAt: string;
    links: number;
    opens: number;
    visitors: number;
    totalMs: number;
    dashboardUrl: string;
  }[];
}

export interface CreateProposalResponse {
  ok: true;
  proposal: {
    id: string;
    linkId: string;
    linkAlias: string;
    title: string;
    originalFilename: string;
    fileSize: number;
    documentType: 'pdf' | 'html';
    accessMode: AccessMode;
    allowedDomains: string;
    expiresAt: string | null;
    shareUrl: string;
    dashboardUrl: string;
  };
}

// ── 원천층(landing) ──
export interface LandedProposal {
  id: string;
  lineageId: string;
  version: number;
  supersedesId: string | null;
  contentHash: string | null;
  source: string | null;
  sourceRef: string | null;
  ingestBatch: string | null;
  metadata: Record<string, unknown>;
  orgId: string | null;
  projectId: string | null;
  linkId: string | null;
  title: string;
  originalFilename: string;
  fileSize: number;
  documentType: string;
  shareUrl: string | null;
  dashboardUrl: string;
}

export interface LandResult {
  ok: boolean;
  file: string;
  deduplicated?: boolean;
  proposal?: LandedProposal;
  baseline?: { status: 'succeeded' | 'failed' | 'skipped'; jobId: string; pageCount?: number; charCount?: number; reason?: string; error?: string } | null;
  error?: string;
}

export interface LandResponse {
  ok: true;
  ingestBatch: string;
  counts: { files: number; landed: number; deduplicated: number; failed: number };
  results: LandResult[];
}

export interface DescriptorsResponse {
  ok: true;
  descriptors: Array<{ id: string; page: number; kind: string; producer: string; producerVersion: string; payload: unknown; updatedAt: string }>;
}

export interface JobsResponse {
  ok: true;
  jobs: Array<{ id: string; kind: string; status: string; attempt: number; worker: string | null; workerVersion: string | null; error: string | null; detail: unknown; queuedAt: string; startedAt: string | null; finishedAt: string | null }>;
}

export interface LinkResponse {
  ok: true;
  link: {
    id: string;
    proposalId: string;
    alias: string;
    accessMode: AccessMode;
    allowedDomains: string;
    expiresAt: string | null;
    disabled: boolean;
    allowDownload: boolean;
    shareUrl: string;
  };
}

export interface LinkSummary {
  id: string;
  alias: string;
  accessMode: AccessMode;
  allowedDomains: string;
  expiresAt: string | null;
  disabled: boolean;
  allowDownload: boolean;
  createdAt: string;
  events: number;
  sessions: number;
  visitors: number;
  totalMs: number;
  shareUrl: string;
}

export interface PageStat {
  pageNumber: number;
  views: number;
  totalMs: number;
  avgMs: number;
}

export interface RecentEvent {
  eventType: string;
  pageNumber: number | null;
  durationMs: number | null;
  target: string | null;
  visitorId: string | null;
  sessionId: string;
  createdAt: string;
  linkId: string | null;
  linkAlias: string | null;
}

export interface ProposalSummaryResponse {
  ok: true;
  proposal: {
    id: string;
    title: string;
    originalFilename: string;
    createdAt: string;
    shareUrl: string;
  };
  summary: {
    links: LinkSummary[];
    visitors: number;
    sessions: number;
    events: number;
    pages: PageStat[];
    actions: { eventType: string; target: string; count: number }[];
    visitorRows: unknown[];
    recentEvents: RecentEvent[];
  };
}
