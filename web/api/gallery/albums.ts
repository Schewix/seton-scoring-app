import type { drive_v3 } from 'googleapis';
import { getDriveClient } from '../_lib/googleDrive.js';

const CACHE_TTL_MS = 10 * 60 * 1000;
const FOLDER_MIME = 'application/vnd.google-apps.folder';

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

function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function normalizeForMatch(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function listAllFolders(parentId: string): Promise<drive_v3.Schema$File[]> {
  const drive = getDriveClient();
  const items: drive_v3.Schema$File[] = [];
  let pageToken: string | undefined = undefined;
  do {
    const { data }: { data: drive_v3.Schema$FileList } = await drive.files.list({
      q: `'${parentId}' in parents and mimeType = '${FOLDER_MIME}' and trashed = false`,
      fields: 'nextPageToken, files(id, name, createdTime, modifiedTime)',
      pageSize: 1000,
      pageToken,
      includeItemsFromAllDrives: true,
      supportsAllDrives: true,
    });
    items.push(...(data.files ?? []));
    pageToken = data.nextPageToken ?? undefined;
  } while (pageToken);
  return items;
}

function sortYearLabel(value: string) {
  const match = value.match(/\d{4}/);
  if (match) {
    return Number(match[0]);
  }
  return Number.NEGATIVE_INFINITY;
}

export default async function handler(req: any, res: any) {
  applyCacheHeaders(res);
  res.setHeader('Access-Control-Allow-Origin', '*');

  const rootFolderId = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID;
  if (!rootFolderId) {
    res.status(500).json({ error: 'Missing GOOGLE_DRIVE_ROOT_FOLDER_ID environment variable.' });
    return;
  }

  const cached = getCache<any>('drive-albums');
  if (cached !== null) {
    res.status(200).json(cached);
    return;
  }

  try {
    const allowlistRaw = process.env.GOOGLE_DRIVE_ALBUM_NAME_ALLOWLIST ?? '';
    const allowlist = allowlistRaw
      .split(/[\n,]/)
      .map((item) => item.trim())
      .filter(Boolean)
      .map(normalizeForMatch);
    const yearFolders = await listAllFolders(rootFolderId);
    const albums: Array<{
      id: string;
      title: string;
      year: string;
      slug: string;
      folderId: string;
    }> = [];

    for (const yearFolder of yearFolders) {
      if (!yearFolder.id) {
        continue;
      }
      const yearName = yearFolder.name ?? 'Ostatní';
      const albumFolders = await listAllFolders(yearFolder.id);
      for (const folder of albumFolders) {
        if (!folder.id || !folder.name) {
          continue;
        }
        if (allowlist.length > 0) {
          const normalizedName = normalizeForMatch(folder.name);
          const isAllowed = allowlist.some((term) => normalizedName.includes(term));
          if (!isAllowed) {
            continue;
          }
        }
        const yearSlug = slugify(yearName);
        const nameSlug = slugify(folder.name);
        const slug = yearSlug ? `${yearSlug}-${nameSlug}` : nameSlug;
        albums.push({
          id: folder.id,
          title: folder.name,
          year: yearName,
          slug,
          folderId: folder.id,
        });
      }
    }

    albums.sort((a, b) => {
      const yearA = sortYearLabel(a.year);
      const yearB = sortYearLabel(b.year);
      if (yearA !== yearB) {
        return yearB - yearA;
      }
      if (a.year !== b.year) {
        return b.year.localeCompare(a.year, 'cs');
      }
      return a.title.localeCompare(b.title, 'cs');
    });

    const payload = { albums };
    setCache('drive-albums', payload);
    res.status(200).json(payload);
  } catch (error) {
    console.error('[api/gallery/albums] failed', error);
    res.status(500).json({ error: 'Failed to load albums from Google Drive.' });
  }
}
