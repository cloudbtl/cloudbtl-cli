// API response shapes — mirrored from cloudbtl-site's @cloudbtl/shared.
// Kept minimal: only the fields this CLI consumes.

export type AccessMode = 'public' | 'passcode' | 'org';

export interface ApiError {
  ok: false;
  error?: string;
  message?: string | string[];
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
