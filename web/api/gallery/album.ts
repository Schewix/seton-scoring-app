import { DRIVE_FIELDS, getDriveClient } from '../_lib/googleDrive.js';

const CACHE_TTL_MS = 10 * 60 * 1000;

const cache = new Map<string, { expiresAt: number; value: any }>();

function getCache<T>(key: string): T | null {
  const entry = cache.get(key);
  if (!entry) {
    return null;
  }
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  return entry.value as T;
}

function setCache<T>(key: string, value: T, ttlMs = CACHE_TTL_MS) {
  cache.set(key, { expiresAt: Date.now() + ttlMs, value });
}

function applyCacheHeaders(res: any) {
  res.setHeader('Cache-Control', 'public, s-maxage=600, stale-while-revalidate=60');
}

function toPageSize(raw: string | string[] | undefined) {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 40;
  }
  return Math.min(Math.max(Math.round(parsed), 1), 100);
}

async function fetchAlbumFiles({
  folderId,
  pageToken,
  pageSize,
}: {
  folderId: string;
  pageToken?: string;
  pageSize: number;
}) {
  const drive = getDriveClient();
  const response = await drive.files.list({
    q: `'${folderId}' in parents and mimeType contains 'image/' and trashed = false`,
    fields: DRIVE_FIELDS,
    pageSize,
    pageToken,
    includeItemsFromAllDrives: true,
    supportsAllDrives: true,
  });
  return response.data;
}

async function fetchAlbumCount(folderId: string) {
  const cached = getCache<number>(`count:${folderId}`);
  if (cached !== null) {
    return cached;
  }
  const drive = getDriveClient();
  let pageToken: string | undefined = undefined;
  let total = 0;
  do {
    const response = await drive.files.list({
      q: `'${folderId}' in parents and mimeType contains 'image/' and trashed = false`,
      fields: 'nextPageToken, files(id)',
      pageSize: 1000,
      pageToken,
      includeItemsFromAllDrives: true,
      supportsAllDrives: true,
    });
    total += response.data.files?.length ?? 0;
    pageToken = response.data.nextPageToken ?? undefined;
  } while (pageToken);
  setCache(`count:${folderId}`, total);
  return total;
}

export default async function handler(req: any, res: any) {
  applyCacheHeaders(res);
  res.setHeader('Access-Control-Allow-Origin', '*');

  const folderId = typeof req.query.folderId === 'string' ? req.query.folderId : '';
  if (!folderId) {
    res.status(400).json({ error: 'Missing folderId query parameter.' });
    return;
  }

  const pageToken = typeof req.query.pageToken === 'string' ? req.query.pageToken : undefined;
  const includeCount = req.query.includeCount === '1' || req.query.includeCount === 'true';
  const pageSize = toPageSize(req.query.pageSize);

  const cacheKey = `files:${folderId}:${pageToken ?? 'first'}:${pageSize}`;
  const cached = getCache<any>(cacheKey);
  if (cached !== null) {
    res.status(200).json(cached);
    return;
  }

  try {
    const data = await fetchAlbumFiles({ folderId, pageToken, pageSize });
    const files = (data.files ?? []).map((file) => ({
      fileId: file.id ?? '',
      name: file.name ?? '',
      thumbnailLink: file.thumbnailLink ?? null,
      fullImageUrl: file.id ? `/api/gallery/image?fileId=${file.id}` : null,
      webContentLink: file.webContentLink ?? null,
    }));

    const totalCount = includeCount ? await fetchAlbumCount(folderId) : undefined;

    const payload = {
      folderId,
      files,
      nextPageToken: data.nextPageToken ?? null,
      totalCount: totalCount ?? null,
    };

    setCache(cacheKey, payload);
    res.status(200).json(payload);
  } catch (error) {
    res.status(500).json({ error: 'Failed to load album from Google Drive.' });
  }
}
