/**
 * Typed helper queries on top of the Prisma client.
 * Each function is a thin, well-typed wrapper — no raw SQL unless noted.
 */

import type { ParsedPick, TweetType, TweetStatus } from '@sports-engine/shared';
import { sha256 } from '@sports-engine/shared';
import { prisma } from './index.js';

// ─── Tracked Accounts ─────────────────────────────────────────────────────────

export async function upsertTrackedAccount(data: {
  username: string;
  displayName?: string;
  sportFocus?: string[];
  priority?: number;
}) {
  return prisma.trackedAccount.upsert({
    where: { username: data.username },
    create: {
      username: data.username,
      displayName: data.displayName ?? '',
      sportFocus: data.sportFocus ?? [],
      priority: data.priority ?? 50,
    },
    update: {
      displayName: data.displayName ?? undefined,
      sportFocus: data.sportFocus ?? undefined,
      priority: data.priority ?? undefined,
    },
  });
}

export async function getActiveAccounts() {
  return prisma.trackedAccount.findMany({
    where: { active: true },
    orderBy: [{ priority: 'asc' }, { lastScannedAt: 'asc' }],
  });
}

export async function updateAccountLastScanned(id: string) {
  return prisma.trackedAccount.update({
    where: { id },
    data: { lastScannedAt: new Date() },
  });
}

// ─── Source Posts ──────────────────────────────────────────────────────────────

export async function saveSourcePost(data: {
  trackedAccountId: string;
  externalUrl: string;
  externalPostKey: string;
  textContent?: string;
  postedAt?: Date;
  screenshotPath?: string;
  rawJson?: unknown;
}) {
  const contentHash = sha256((data.textContent ?? '').trim().toLowerCase());

  // Silently skip duplicates by returning existing record
  const existing = await prisma.sourcePost.findUnique({
    where: { externalPostKey: data.externalPostKey },
  });
  if (existing) return existing;

  return prisma.sourcePost.create({
    data: {
      trackedAccountId: data.trackedAccountId,
      externalUrl: data.externalUrl,
      externalPostKey: data.externalPostKey,
      textContent: data.textContent ?? '',
      contentHash,
      postedAt: data.postedAt,
      screenshotPath: data.screenshotPath,
      rawJson: data.rawJson !== undefined ? (data.rawJson as object) : undefined,
    },
  });
}

export async function markPostProcessed(id: string) {
  return prisma.sourcePost.update({
    where: { id },
    data: { processed: true },
  });
}

// ─── Source Media ──────────────────────────────────────────────────────────────

export async function saveSourceMedia(data: {
  sourcePostId: string;
  mediaUrl?: string;
  filePath?: string;
  mimeType?: string;
  width?: number;
  height?: number;
  ocrNeeded?: boolean;
}) {
  return prisma.sourceMedia.create({
    data: {
      sourcePostId: data.sourcePostId,
      mediaUrl: data.mediaUrl,
      filePath: data.filePath,
      mimeType: data.mimeType ?? 'image/jpeg',
      width: data.width,
      height: data.height,
      ocrNeeded: data.ocrNeeded ?? true,
      ocrStatus: 'PENDING',
    },
  });
}

export async function getPendingOcrMedia(limit = 20) {
  return prisma.sourceMedia.findMany({
    where: { ocrStatus: 'PENDING', ocrNeeded: true },
    orderBy: { createdAt: 'asc' },
    take: limit,
    include: { sourcePost: true },
  });
}

export async function updateMediaOcr(id: string, ocrText: string, confidence: number) {
  return prisma.sourceMedia.update({
    where: { id },
    data: {
      ocrText,
      ocrConfidence: confidence,
      ocrStatus: 'DONE',
    },
  });
}

// ─── Extracted Picks ───────────────────────────────────────────────────────────

export async function saveExtractedPick(data: ParsedPick & { sourcePostId: string }) {
  return prisma.extractedPick.create({
    data: {
      sourcePostId: data.sourcePostId,
      sport: data.sport,
      league: data.league,
      gameLabel: data.gameLabel,
      teams: data.teams,
      playerName: data.playerName,
      marketType: data.marketType,
      betSide: data.betSide,
      line: data.line,
      odds: data.odds !== undefined ? Math.round(data.odds) : undefined,
      normalizedLabel: data.normalizedLabel,
      evidenceText: data.evidenceText,
      confidence: data.confidence,
    },
  });
}

export async function getRecentPicks(hours = 24) {
  const since = new Date(Date.now() - hours * 60 * 60 * 1000);
  return prisma.extractedPick.findMany({
    where: { createdAt: { gte: since } },
    orderBy: { createdAt: 'desc' },
    include: { sourcePost: { include: { trackedAccount: true } } },
  });
}

// ─── Pick Clusters ─────────────────────────────────────────────────────────────

export async function saveCluster(data: {
  label: string;
  sport?: string;
  clusterType: string;
  confidence: number;
  trendScore: number;
  supportCount: number;
  tags: string[];
  pickIds?: string[];
}) {
  const cluster = await prisma.pickCluster.upsert({
    where: {
      // We use a compound approach: find by label+sport, handled via findFirst + upsert pattern
      id: (
        await prisma.pickCluster.findFirst({
          where: { label: data.label, sport: data.sport ?? null },
          select: { id: true },
        })
      )?.id ?? '__new__',
    },
    create: {
      label: data.label,
      sport: data.sport,
      clusterType: data.clusterType as never,
      confidence: data.confidence,
      trendScore: data.trendScore,
      supportCount: data.supportCount,
      tags: data.tags,
    },
    update: {
      confidence: data.confidence,
      trendScore: data.trendScore,
      supportCount: data.supportCount,
      tags: data.tags,
    },
  });

  // Link picks if provided
  if (data.pickIds && data.pickIds.length > 0) {
    for (const extractedPickId of data.pickIds) {
      await prisma.pickClusterMembership.upsert({
        where: { clusterId_extractedPickId: { clusterId: cluster.id, extractedPickId } },
        create: { clusterId: cluster.id, extractedPickId },
        update: {},
      });
    }
  }

  return cluster;
}

// ─── Tweet Drafts ──────────────────────────────────────────────────────────────

export async function saveTweetDraft(data: {
  tweetType: TweetType;
  text: string;
  generationModel: string;
  sourceEvidence?: unknown;
}) {
  return prisma.tweetDraft.create({
    data: {
      tweetType: data.tweetType,
      text: data.text,
      generationModel: data.generationModel,
      sourceEvidence: data.sourceEvidence !== undefined ? (data.sourceEvidence as object) : undefined,
      status: 'DRAFT',
    },
  });
}

export async function getTweetDrafts(status?: TweetStatus, limit = 50) {
  return prisma.tweetDraft.findMany({
    where: status ? { status } : undefined,
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: { clusters: { include: { cluster: true } } },
  });
}

export async function updateTweetDraftStatus(id: string, status: TweetStatus, note?: string) {
  return prisma.tweetDraft.update({
    where: { id },
    data: {
      status,
      approvalNote: note,
    },
  });
}

// ─── System Settings ───────────────────────────────────────────────────────────

export async function getSystemSetting(
  key: string,
  defaultValue?: string,
): Promise<string | undefined> {
  const record = await prisma.systemSetting.findUnique({ where: { key } });
  return record?.value ?? defaultValue;
}

export async function setSystemSetting(key: string, value: string) {
  return prisma.systemSetting.upsert({
    where: { key },
    create: { key, value },
    update: { value },
  });
}
