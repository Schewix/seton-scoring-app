import type { drive_v3 } from 'googleapis';
import { fetchScriptItems, hasGalleryScript } from '../../api-lib/galleryScript.js';
import { DRIVE_FIELDS, getDriveClient, getDriveListOptions } from '../../api-lib/googleDrive.js';

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
    console.error('[api/gallery/album] failed', error);
    res.status(500).json({ error: 'Failed to load album from Google Drive.' });
  }
}
