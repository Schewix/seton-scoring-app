import type { drive_v3 } from 'googleapis';
import { fetchScriptItems, hasGalleryScript } from '../api-lib/galleryScript.js';
import { getSupabaseAdminClient } from '../api-lib/content/supabaseAdmin.js';
import { DRIVE_FIELDS, getDriveClient, getDriveListOptions } from '../api-lib/googleDrive.js';

const CACHE_TTL_MS = 60 * 60 * 1000;
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

function applyAlbumCacheHeaders(res: any) {
  res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=300');
}

function applyAlbumsCacheHeaders(res: any, bypassCache: boolean) {
  if (bypassCache) {
    res.setHeader('Cache-Control', 'no-store');
    return;
  }
  res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=300');
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

async function fetchAlbumOverrides(): Promise<Map<string, string>> {
  try {
    const supabase = getSupabaseAdminClient();
    const { data, error } = await supabase.from('content_gallery_albums').select('folder_id,title');
    if (error) {
      console.error('[api/gallery] failed to load overrides', error);
      return new Map();
    }
    return new Map((data ?? []).map((row: { folder_id: string; title: string }) => [row.folder_id, row.title]));
  } catch (error) {
    console.warn('[api/gallery] overrides unavailable', error);
    return new Map();
  }
}

async function listAllFolders(parentId: string): Promise<drive_v3.Schema$File[]> {
  if (hasGalleryScript()) {
    const items = await fetchScriptItems(parentId);
    return items
      .filter((item) => item.type === 'folder')
      .map((item) => ({
        id: item.id,
        name: item.name,
        mimeType: FOLDER_MIME,
      }));
  }
  const drive = getDriveClient();
  const items: drive_v3.Schema$File[] = [];
  let pageToken: string | undefined = undefined;
  do {
    const { data }: { data: drive_v3.Schema$FileList } = await drive.files.list({
      q: `'${parentId}' in parents and (mimeType = '${FOLDER_MIME}' or mimeType = 'application/vnd.google-apps.shortcut') and trashed = false`,
      fields: 'nextPageToken, files(id, name, createdTime, modifiedTime, mimeType, shortcutDetails)',
      pageSize: 1000,
      pageToken,
      includeItemsFromAllDrives: true,
      supportsAllDrives: true,
      ...getDriveListOptions(),
    });
    for (const file of data.files ?? []) {
      if (file.mimeType === FOLDER_MIME && file.id) {
        items.push(file);
        continue;
      }
      if (
        file.mimeType === 'application/vnd.google-apps.shortcut' &&
        file.shortcutDetails?.targetMimeType === FOLDER_MIME &&
        file.shortcutDetails.targetId
      ) {
        items.push({
          id: file.shortcutDetails.targetId,
          name: file.name,
          createdTime: file.createdTime,
          modifiedTime: file.modifiedTime,
          mimeType: FOLDER_MIME,
        });
      }
    }
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

function toPageSize(raw: string | string[] | undefined) {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 40;
  }
  return Math.min(Math.max(Math.round(parsed), 1), 100);
}

async function fetchAlbumFiles({
  folderIds,
  pageToken,
  pageSize,
  includeSubfolders,
}: {
  folderIds: string[];
  pageToken?: string;
  pageSize: number;
  includeSubfolders: boolean;
}): Promise<drive_v3.Schema$FileList> {
  if (hasGalleryScript()) {
    const images = await fetchScriptImages(folderIds, includeSubfolders);
    const offset = pageToken ? Math.max(Number(pageToken) || 0, 0) : 0;
    const slice = images.slice(offset, offset + pageSize);
    return {
      nextPageToken: offset + pageSize < images.length ? String(offset + pageSize) : undefined,
      files: slice.map((item) => ({
        id: item.fileId,
        name: item.name,
        mimeType: 'image/*',
        thumbnailLink: item.thumbnailLink ?? undefined,
        webContentLink: item.webContentLink ?? undefined,
      })),
    };
  }
  const drive = getDriveClient();
  const parentsQuery = folderIds.map((id) => `'${id}' in parents`).join(' or ');
  const { data }: { data: drive_v3.Schema$FileList } = await drive.files.list({
    q: `(${parentsQuery}) and (mimeType contains 'image/' or (mimeType = 'application/vnd.google-apps.shortcut' and shortcutDetails.targetMimeType contains 'image/')) and trashed = false`,
    fields: DRIVE_FIELDS,
    pageSize,
    pageToken,
    includeItemsFromAllDrives: true,
    supportsAllDrives: true,
    ...getDriveListOptions(),
  });
  return data;
}

async function fetchAlbumCount(folderIds: string[], includeSubfolders: boolean) {
  if (hasGalleryScript()) {
    const images = await fetchScriptImages(folderIds, includeSubfolders);
    return images.length;
  }
  const cacheKey = `count:${folderIds.join(',')}`;
  const cached = getCache<number>(cacheKey);
  if (cached !== null) {
    return cached;
  }
  const drive = getDriveClient();
  let pageToken: string | undefined = undefined;
  let total = 0;
  const parentsQuery = folderIds.map((id) => `'${id}' in parents`).join(' or ');
  do {
    const { data }: { data: drive_v3.Schema$FileList } = await drive.files.list({
      q: `(${parentsQuery}) and (mimeType contains 'image/' or (mimeType = 'application/vnd.google-apps.shortcut' and shortcutDetails.targetMimeType contains 'image/')) and trashed = false`,
      fields: 'nextPageToken, files(id)',
      pageSize: 1000,
      pageToken,
      includeItemsFromAllDrives: true,
      supportsAllDrives: true,
      ...getDriveListOptions(),
    });
    total += data.files?.length ?? 0;
    pageToken = data.nextPageToken ?? undefined;
  } while (pageToken);
  setCache(cacheKey, total);
  return total;
}

async function listChildFolderIds(parentId: string): Promise<string[]> {
  if (hasGalleryScript()) {
    const items = await fetchScriptItems(parentId);
    return items.filter((item) => item.type === 'folder').map((item) => item.id);
  }
  const drive = getDriveClient();
  const ids: string[] = [];
  let pageToken: string | undefined = undefined;
  do {
    const { data }: { data: drive_v3.Schema$FileList } = await drive.files.list({
      q: `'${parentId}' in parents and (mimeType = '${FOLDER_MIME}' or mimeType = 'application/vnd.google-apps.shortcut') and trashed = false`,
      fields: 'nextPageToken, files(id, mimeType, shortcutDetails)',
      pageSize: 1000,
      pageToken,
      includeItemsFromAllDrives: true,
      supportsAllDrives: true,
      ...getDriveListOptions(),
    });
    for (const file of data.files ?? []) {
      if (file.mimeType === FOLDER_MIME && file.id) {
        ids.push(file.id);
        continue;
      }
      if (
        file.mimeType === 'application/vnd.google-apps.shortcut' &&
        file.shortcutDetails?.targetMimeType === FOLDER_MIME &&
        file.shortcutDetails.targetId
      ) {
        ids.push(file.shortcutDetails.targetId);
      }
    }
    pageToken = data.nextPageToken ?? undefined;
  } while (pageToken);
  return ids;
}

async function listDescendantFolderIds(parentId: string): Promise<string[]> {
  const seen = new Set<string>();
  const queue: string[] = [parentId];
  const descendants: string[] = [];

  while (queue.length > 0) {
    const currentId = queue.shift();
    if (!currentId) continue;
    const childIds = await listChildFolderIds(currentId);
    for (const id of childIds) {
      if (seen.has(id)) continue;
      seen.add(id);
      descendants.push(id);
      queue.push(id);
    }
  }

  return descendants;
}

async function fetchScriptImages(folderIds: string[], includeSubfolders: boolean) {
  const images: Array<{
    fileId: string;
    name: string;
    thumbnailLink: string | null;
    fullImageUrl: string | null;
    webContentLink: string | null;
  }> = [];
  const visited = new Set<string>();
  const queue = [...folderIds];

  while (queue.length > 0) {
    const currentId = queue.shift();
    if (!currentId || visited.has(currentId)) {
      continue;
    }
    visited.add(currentId);
    const items = await fetchScriptItems(currentId);
    for (const item of items) {
      if (item.type === 'folder') {
        if (includeSubfolders) {
          queue.push(item.id);
        }
        continue;
      }
      if (item.type === 'image') {
        images.push({
          fileId: item.id,
          name: item.name ?? '',
          thumbnailLink: item.thumb ?? null,
          fullImageUrl: item.src ?? null,
          webContentLink: item.src ?? null,
        });
      }
    }
  }

  images.sort((a, b) => a.name.localeCompare(b.name, 'cs'));
  return images;
}

async function handleAlbums(req: any, res: any) {
  const bypassCache =
    req.query?.nocache === '1' ||
    req.query?.nocache === 'true' ||
    req.query?.nocache === 'yes';
  applyAlbumsCacheHeaders(res, bypassCache);
  res.setHeader('Access-Control-Allow-Origin', '*');

  const rootFolderId = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID;
  if (!rootFolderId) {
    res.status(500).json({ error: 'Missing GOOGLE_DRIVE_ROOT_FOLDER_ID environment variable.' });
    return;
  }

  if (bypassCache) {
    cache.delete('drive-albums');
    cache.delete('drive-album-overrides');
  } else {
    const cached = getCache<any>('drive-albums');
    if (cached !== null) {
      res.status(200).json(cached);
      return;
    }
  }

  try {
    let overrides: Map<string, string>;
    if (!bypassCache) {
      const cachedOverrides = getCache<Map<string, string>>('drive-album-overrides');
      overrides = cachedOverrides ?? (await fetchAlbumOverrides());
      if (!cachedOverrides) {
        setCache('drive-album-overrides', overrides);
      }
    } else {
      overrides = await fetchAlbumOverrides();
    }

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
      baseTitle?: string;
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
        const baseTitle = folder.name;
        const overrideTitle = folder.id ? overrides.get(folder.id) : undefined;
        const title = overrideTitle && overrideTitle.trim().length > 0 ? overrideTitle.trim() : baseTitle;
        const yearSlug = slugify(yearName);
        const nameSlug = slugify(baseTitle);
        const slug = yearSlug ? `${yearSlug}-${nameSlug}` : nameSlug;
        albums.push({
          id: folder.id,
          title,
          year: yearName,
          slug,
          folderId: folder.id,
          baseTitle,
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
    if (!bypassCache) {
      setCache('drive-albums', payload);
    }
    res.status(200).json(payload);
  } catch (error) {
    console.error('[api/gallery] failed to load albums', error);
    res.status(500).json({ error: 'Failed to load albums from Google Drive.' });
  }
}

async function handleAlbum(req: any, res: any, folderId: string) {
  applyAlbumCacheHeaders(res);
  res.setHeader('Access-Control-Allow-Origin', '*');

  const pageToken = typeof req.query.pageToken === 'string' ? req.query.pageToken : undefined;
  const includeCount = req.query.includeCount === '1' || req.query.includeCount === 'true';
  const includeSubfolders = req.query.includeSubfolders === '1' || req.query.includeSubfolders === 'true';
  const pageSize = toPageSize(req.query.pageSize);

  const folderIds =
    includeSubfolders && !hasGalleryScript()
      ? [folderId, ...(await listDescendantFolderIds(folderId))]
      : [folderId];
  const cacheKey = `files:${folderId}:${includeSubfolders ? 'sub' : 'root'}:${pageToken ?? 'first'}:${pageSize}`;
  const cached = getCache<any>(cacheKey);
  if (cached !== null) {
    res.status(200).json(cached);
    return;
  }

  try {
    const data = await fetchAlbumFiles({ folderIds, pageToken, pageSize, includeSubfolders });
    const files = (data.files ?? [])
      .map((file: drive_v3.Schema$File) => {
        const isShortcut = file.mimeType === 'application/vnd.google-apps.shortcut';
        const targetId = file.shortcutDetails?.targetId;
        const targetMime = file.shortcutDetails?.targetMimeType ?? '';
        const isImageShortcut = isShortcut && targetMime.startsWith('image/');
        const fileId = isImageShortcut ? targetId ?? '' : file.id ?? '';
        if (!fileId) {
          return null;
        }
        return {
          fileId,
          name: file.name ?? '',
          thumbnailLink: file.thumbnailLink ?? null,
          fullImageUrl: `/api/gallery/image?fileId=${fileId}`,
          webContentLink: file.webContentLink ?? null,
        };
      })
      .filter(
        (file): file is {
          fileId: string;
          name: string;
          thumbnailLink: string | null;
          fullImageUrl: string;
          webContentLink: string | null;
        } => Boolean(file),
      );

    const totalCount = includeCount ? await fetchAlbumCount(folderIds, includeSubfolders) : undefined;

    const payload = {
      folderId,
      files,
      nextPageToken: data.nextPageToken ?? null,
      totalCount: totalCount ?? null,
    };

    if (req.query.debug === '1') {
      res.status(200).json({
        ...payload,
        folderIds,
      });
      return;
    }

    setCache(cacheKey, payload);
    res.status(200).json(payload);
  } catch (error) {
    console.error('[api/gallery] failed to load album', error);
    res.status(500).json({ error: 'Failed to load album from Google Drive.' });
  }
}

export default async function handler(req: any, res: any) {
  const folderId = typeof req.query.folderId === 'string' ? req.query.folderId : '';
  if (folderId) {
    return handleAlbum(req, res, folderId);
  }
  return handleAlbums(req, res);
}
