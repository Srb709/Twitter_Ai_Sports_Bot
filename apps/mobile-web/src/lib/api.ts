import type { TweetStatus } from '@sports-engine/shared';

// ─── Internal fetch helper ───────────────────────────────────────────────────

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`API ${path} failed [${res.status}]: ${text}`);
  }
  return res.json() as Promise<T>;
}

// ─── Tweets ──────────────────────────────────────────────────────────────────

export interface TweetDraftDTO {
  id: string;
  tweetType: string;
  text: string;
  status: TweetStatus;
  generationModel: string;
  approvalNote: string | null;
  createdAt: string;
  updatedAt: string;
}

async function listTweets(status?: TweetStatus): Promise<TweetDraftDTO[]> {
  const params = status ? `?status=${status}` : '';
  return apiFetch<TweetDraftDTO[]>(`/api/tweets${params}`);
}

async function updateTweetStatus(
  id: string,
  status: TweetStatus,
  note?: string,
): Promise<TweetDraftDTO> {
  return apiFetch<TweetDraftDTO>(`/api/tweets/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ status, note }),
  });
}

// ─── Accounts ────────────────────────────────────────────────────────────────

export interface TrackedAccountDTO {
  id: string;
  username: string;
  displayName: string;
  active: boolean;
  priority: number;
  sportFocus: string[];
  notes: string;
  lastScannedAt: string | null;
  createdAt: string;
}

async function listAccounts(): Promise<TrackedAccountDTO[]> {
  return apiFetch<TrackedAccountDTO[]>('/api/accounts');
}

async function createAccount(data: {
  username: string;
  displayName?: string;
  sportFocus?: string[];
  priority?: number;
  notes?: string;
}): Promise<TrackedAccountDTO> {
  return apiFetch<TrackedAccountDTO>('/api/accounts', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

async function updateAccount(
  id: string,
  data: Partial<{
    active: boolean;
    priority: number;
    notes: string;
    sportFocus: string[];
    displayName: string;
  }>,
): Promise<TrackedAccountDTO> {
  return apiFetch<TrackedAccountDTO>(`/api/accounts/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

async function removeAccount(id: string): Promise<void> {
  await apiFetch<{ ok: boolean }>(`/api/accounts/${id}`, { method: 'DELETE' });
}

// ─── Picks ────────────────────────────────────────────────────────────────────

export interface ExtractedPickDTO {
  id: string;
  sourcePostId: string;
  sport: string;
  playerName: string | null;
  marketType: string;
  betSide: string | null;
  line: number | null;
  odds: number | null;
  normalizedLabel: string;
  evidenceText: string;
  confidence: number;
  createdAt: string;
  sourcePost?: {
    trackedAccount?: { username: string };
  };
}

async function listPicks(filters?: {
  sport?: string;
  marketType?: string;
  limit?: number;
}): Promise<ExtractedPickDTO[]> {
  const params = new URLSearchParams();
  if (filters?.sport) params.set('sport', filters.sport);
  if (filters?.marketType) params.set('marketType', filters.marketType);
  if (filters?.limit) params.set('limit', String(filters.limit));
  const qs = params.toString();
  return apiFetch<ExtractedPickDTO[]>(`/api/picks${qs ? `?${qs}` : ''}`);
}

// ─── Trends ───────────────────────────────────────────────────────────────────

export interface PickClusterDTO {
  id: string;
  label: string;
  sport: string | null;
  clusterType: string;
  confidence: number;
  trendScore: number;
  supportCount: number;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  members?: Array<{
    extractedPick: ExtractedPickDTO;
  }>;
}

async function listTrends(): Promise<PickClusterDTO[]> {
  return apiFetch<PickClusterDTO[]>('/api/trends');
}

// ─── Settings ─────────────────────────────────────────────────────────────────

export interface SystemSettingsDTO {
  scanIntervalMinutes: number;
  aiProvider: 'openai' | 'anthropic';
  aiModel: string;
  lastScanAt: string | null;
}

async function getSettings(): Promise<SystemSettingsDTO> {
  return apiFetch<SystemSettingsDTO>('/api/settings');
}

async function updateSettings(
  data: Partial<SystemSettingsDTO>,
): Promise<SystemSettingsDTO> {
  return apiFetch<SystemSettingsDTO>('/api/settings', {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

// ─── Posts ────────────────────────────────────────────────────────────────────

export interface SourcePostDTO {
  id: string;
  trackedAccountId: string;
  externalUrl: string;
  textContent: string;
  postedAt: string | null;
  scrapedAt: string;
  processed: boolean;
  createdAt: string;
  trackedAccount?: { username: string; displayName: string };
  _count?: { media: number };
}

async function listPosts(filters?: {
  account?: string;
  limit?: number;
}): Promise<SourcePostDTO[]> {
  const params = new URLSearchParams();
  if (filters?.account) params.set('account', filters.account);
  if (filters?.limit) params.set('limit', String(filters.limit));
  const qs = params.toString();
  return apiFetch<SourcePostDTO[]>(`/api/posts${qs ? `?${qs}` : ''}`);
}

// ─── Exports ─────────────────────────────────────────────────────────────────

export const api = {
  tweets: {
    list: listTweets,
    updateStatus: updateTweetStatus,
  },
  accounts: {
    list: listAccounts,
    create: createAccount,
    update: updateAccount,
    remove: removeAccount,
  },
  picks: {
    list: listPicks,
  },
  trends: {
    list: listTrends,
  },
  settings: {
    get: getSettings,
    update: updateSettings,
  },
  posts: {
    list: listPosts,
  },
};
