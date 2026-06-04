import type { drive_v3 } from 'googleapis';
import { fetchScriptItems, hasGalleryScript } from '../api-lib/galleryScript.js';
import {
  fetchR2Json,
  getR2GalleryConfig,
  getR2GalleryConfigError,
  isR2GalleryRequiredByEnv,
  normalizeR2GalleryIndex,
  normalizeR2GalleryManifest,
  toR2PublicUrl,
  type R2GalleryConfig,
  type R2GalleryIndex,
  type R2GalleryIndexAlbum,
  type R2GalleryManifest,
  type R2GalleryManifestPhoto,
} from '../api-lib/galleryR2.js';
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

function clearAlbumsCache() {
  for (const key of cache.keys()) {
    if (
      key === 'drive-album-overrides' ||
      key === 'drive-album-years' ||
      key === 'drive-albums' ||
      key.startsWith('drive-albums:') ||
      key.startsWith('r2-gallery:')
    ) {
      cache.delete(key);
    }
  }
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

function parseAlbumAllowlist(raw: string): string[] {
  return raw
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .map(normalizeForMatch);
}

function isAlbumAllowedByAllowlist(albumName: string, allowlist: string[]): boolean {
  if (allowlist.length === 0) {
    return true;
  }
  const normalizedName = normalizeForMatch(albumName);
  return allowlist.some((term) => normalizedName.includes(term));
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

function toAlbumsLimit(raw: string | string[] | undefined) {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return Math.min(Math.max(Math.round(parsed), 1), 200);
}

function sortAlbums<T extends { year: string; title: string }>(albums: T[]): T[] {
  return [...albums].sort((a, b) => {
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
}

async function fetchAlbumOverridesCached(bypassCache: boolean): Promise<Map<string, string>> {
  if (bypassCache) {
    return fetchAlbumOverrides();
  }

  const cachedOverrides = getCache<Map<string, string>>('drive-album-overrides');
  if (cachedOverrides) {
    return cachedOverrides;
  }

  const overrides = await fetchAlbumOverrides();
  setCache('drive-album-overrides', overrides);
  return overrides;
}

async function loadR2GalleryIndex(config: R2GalleryConfig, bypassCache: boolean): Promise<R2GalleryIndex> {
  const cacheKey = `r2-gallery:index:${config.publicBaseUrl}:${config.indexPath}`;
  if (!bypassCache) {
    const cached = getCache<R2GalleryIndex>(cacheKey);
    if (cached !== null) {
      return cached;
    }
  }

  const raw = await fetchR2Json<unknown>(config, config.indexPath);
  const index = normalizeR2GalleryIndex(raw);
  if (!bypassCache) {
    setCache(cacheKey, index);
  }
  return index;
}

async function loadR2GalleryManifest(
  config: R2GalleryConfig,
  album: R2GalleryIndexAlbum,
): Promise<R2GalleryManifest> {
  const cacheKey = `r2-gallery:manifest:${config.publicBaseUrl}:${album.manifestPath}`;
  const cached = getCache<R2GalleryManifest>(cacheKey);
  if (cached !== null) {
    return cached;
  }

  const raw = await fetchR2Json<unknown>(config, album.manifestPath);
  const manifest = normalizeR2GalleryManifest(raw);
  setCache(cacheKey, manifest);
  return manifest;
}

function toR2AlbumPayload(album: R2GalleryIndexAlbum, overrides: Map<string, string>) {
  const overrideTitle = overrides.get(album.driveFolderId) ?? overrides.get(album.folderId);
  const title = overrideTitle && overrideTitle.trim().length > 0 ? overrideTitle.trim() : album.title;
  return {
    id: album.id,
    title,
    year: album.year ?? 'Ostatní',
    slug: album.slug,
    folderId: album.folderId,
    baseTitle: album.baseTitle ?? album.title,
    source: 'cloudflare-r2',
  };
}

function findR2Album(index: R2GalleryIndex, folderId: string): R2GalleryIndexAlbum | null {
  return (
    index.albums.find(
      (album) =>
        album.folderId === folderId ||
        album.driveFolderId === folderId ||
        album.id === folderId ||
        album.slug === folderId,
    ) ?? null
  );
}

function getR2PhotoUrl(config: R2GalleryConfig, url: string | undefined, path: string) {
  return url && url.trim().length > 0 ? url : toR2PublicUrl(config, path);
}

function toR2FilePayload(config: R2GalleryConfig, photo: R2GalleryManifestPhoto) {
  const fullImageUrl = getR2PhotoUrl(config, photo.fullUrl, photo.fullPath);
  const thumbnailLink = getR2PhotoUrl(config, photo.thumbUrl, photo.thumbPath);
  return {
    fileId: photo.sourceFileId || photo.fullPath,
    name: photo.originalName || photo.sourceFileId || photo.fullPath,
    thumbnailLink,
    fullImageUrl,
    webContentLink: fullImageUrl,
    width: photo.width ?? null,
    height: photo.height ?? null,
    thumbWidth: photo.thumbWidth ?? null,
    thumbHeight: photo.thumbHeight ?? null,
    source: 'cloudflare-r2',
  };
}

async function handleR2Albums(req: any, res: any, config: R2GalleryConfig) {
  const bypassCache =
    req.query?.nocache === '1' ||
    req.query?.nocache === 'true' ||
    req.query?.nocache === 'yes';
  const yearFilter = typeof req.query?.year === 'string' ? req.query.year.trim() : '';
  const yearsOnly = req.query?.years === '1' || req.query?.years === 'true';
  const albumsLimit = toAlbumsLimit(req.query?.limit);
  const index = await loadR2GalleryIndex(config, bypassCache);

  if (yearsOnly) {
    const sortedAlbums = sortAlbums(
      index.albums.map((album) => ({
        title: album.title,
        year: album.year ?? 'Ostatní',
      })),
    );
    const years = Array.from(new Set(sortedAlbums.map((album) => album.year)));
    const albumCountsByYear = index.albums.reduce<Record<string, number>>((acc, album) => {
      const year = album.year ?? 'Ostatní';
      acc[year] = (acc[year] ?? 0) + 1;
      return acc;
    }, {});
    res.status(200).json({ years, albumCountsByYear, source: 'cloudflare-r2' });
    return;
  }

  const overrides = await fetchAlbumOverridesCached(bypassCache);
  const albums = sortAlbums(
    index.albums
      .filter((album) => !yearFilter || (album.year ?? 'Ostatní') === yearFilter)
      .map((album) => toR2AlbumPayload(album, overrides)),
  );

  res.status(200).json({
    albums: albumsLimit ? albums.slice(0, albumsLimit) : albums,
    source: 'cloudflare-r2',
  });
}

async function handleR2Album(
  req: any,
  res: any,
  config: R2GalleryConfig,
  folderId: string,
): Promise<boolean> {
  const pageToken = typeof req.query.pageToken === 'string' ? req.query.pageToken : undefined;
  const includeCount = req.query.includeCount === '1' || req.query.includeCount === 'true';
  const pageSize = toPageSize(req.query.pageSize);
  const offset = pageToken ? Math.max(Number(pageToken) || 0, 0) : 0;
  const cacheKey = `r2-gallery:files:${config.publicBaseUrl}:${folderId}:${offset}:${pageSize}:${includeCount ? 'count' : 'nocount'}`;
  const cached = getCache<any>(cacheKey);
  if (cached !== null) {
    res.status(200).json(cached);
    return true;
  }

  const index = await loadR2GalleryIndex(config, false);
  const album = findR2Album(index, folderId);
  if (!album) {
    return false;
  }

  const manifest = await loadR2GalleryManifest(config, album);
  const slice = manifest.photos.slice(offset, offset + pageSize);
  const nextOffset = offset + pageSize;
  const payload = {
    folderId,
    files: slice.map((photo) => toR2FilePayload(config, photo)),
    nextPageToken: nextOffset < manifest.photos.length ? String(nextOffset) : null,
    totalCount: includeCount ? manifest.photos.length : null,
    source: 'cloudflare-r2',
  };

  if (req.query.debug === '1') {
    res.status(200).json({
      ...payload,
      manifestPath: album.manifestPath,
    });
    return true;
  }

  setCache(cacheKey, payload);
  res.status(200).json(payload);
  return true;
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
  const yearFilter = typeof req.query?.year === 'string' ? req.query.year.trim() : '';
  const yearsOnly = req.query?.years === '1' || req.query?.years === 'true';
  const albumsLimit = toAlbumsLimit(req.query?.limit);
  const cacheKey = yearsOnly
    ? 'drive-album-years'
    : `drive-albums:${yearFilter || 'all'}:${albumsLimit ?? 'all'}`;
  applyAlbumsCacheHeaders(res, bypassCache);
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (bypassCache) {
    clearAlbumsCache();
  }

  const r2Config = getR2GalleryConfig();
  if (r2Config) {
    try {
      await handleR2Albums(req, res, r2Config);
      return;
    } catch (error) {
      console.warn('[api/gallery] failed to load albums from Cloudflare R2', error);
      if (r2Config.sourceMode === 'r2') {
        res.status(500).json({ error: 'Failed to load albums from Cloudflare R2.' });
        return;
      }
    }
  } else if (isR2GalleryRequiredByEnv()) {
    res.status(500).json({ error: getR2GalleryConfigError() });
    return;
  }

  const rootFolderId = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID;
  if (!rootFolderId) {
    res.status(500).json({ error: 'Missing GOOGLE_DRIVE_ROOT_FOLDER_ID environment variable.' });
    return;
  }

  if (!bypassCache) {
    const cached = getCache<any>(cacheKey);
    if (cached !== null) {
      res.status(200).json(cached);
      return;
    }
  }

  try {
    const yearFolders = await listAllFolders(rootFolderId);
    const allowlist = parseAlbumAllowlist(process.env.GOOGLE_DRIVE_ALBUM_NAME_ALLOWLIST ?? '');

    if (yearsOnly) {
      const yearEntries = await Promise.all(
        yearFolders.map(async (folder) => {
          const year = folder.name ?? 'Ostatní';
          if (!folder.id) {
            return { year, albumCount: 0 };
          }
          const albumFolders = await listAllFolders(folder.id);
          const albumCount = albumFolders.filter((albumFolder) => {
            if (!albumFolder.name) {
              return false;
            }
            return isAlbumAllowedByAllowlist(albumFolder.name, allowlist);
          }).length;
          return { year, albumCount };
        }),
      );
      yearEntries.sort((a, b) => {
        const yearA = sortYearLabel(a.year);
        const yearB = sortYearLabel(b.year);
        if (yearA !== yearB) {
          return yearB - yearA;
        }
        return b.year.localeCompare(a.year, 'cs');
      });
      const years = yearEntries.map((entry) => entry.year);
      const albumCountsByYear = yearEntries.reduce<Record<string, number>>((acc, entry) => {
        acc[entry.year] = entry.albumCount;
        return acc;
      }, {});
      const payload = { years, albumCountsByYear };
      if (!bypassCache) {
        setCache(cacheKey, payload);
      }
      res.status(200).json(payload);
      return;
    }

    const overrides = await fetchAlbumOverridesCached(bypassCache);

    const scopedYearFolders = yearFilter
      ? yearFolders.filter((folder) => (folder.name ?? 'Ostatní') === yearFilter)
      : yearFolders;
    const albums: Array<{
      id: string;
      title: string;
      year: string;
      slug: string;
      folderId: string;
      baseTitle?: string;
    }> = [];

    for (const yearFolder of scopedYearFolders) {
      if (!yearFolder.id) {
        continue;
      }
      const yearName = yearFolder.name ?? 'Ostatní';
      const albumFolders = await listAllFolders(yearFolder.id);
      for (const folder of albumFolders) {
        if (!folder.id || !folder.name) {
          continue;
        }
        if (!isAlbumAllowedByAllowlist(folder.name, allowlist)) {
          continue;
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

    const payload = { albums: albumsLimit ? albums.slice(0, albumsLimit) : albums };
    if (!bypassCache) {
      setCache(cacheKey, payload);
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

  const r2Config = getR2GalleryConfig();
  if (r2Config) {
    try {
      const handled = await handleR2Album(req, res, r2Config, folderId);
      if (handled) {
        return;
      }
      if (r2Config.sourceMode === 'r2') {
        res.status(404).json({ error: 'Album not found in Cloudflare R2 gallery index.' });
        return;
      }
    } catch (error) {
      console.warn('[api/gallery] failed to load album from Cloudflare R2', error);
      if (r2Config.sourceMode === 'r2') {
        res.status(500).json({ error: 'Failed to load album from Cloudflare R2.' });
        return;
      }
    }
  } else if (isR2GalleryRequiredByEnv()) {
    res.status(500).json({ error: getR2GalleryConfigError() });
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
