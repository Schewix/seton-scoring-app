export type R2GallerySourceMode = 'auto' | 'drive' | 'r2';

export type R2GalleryConfig = {
  publicBaseUrl: string;
  indexPath: string;
  sourceMode: R2GallerySourceMode;
};

export type R2GalleryIndexPhoto = {
  sourceFileId: string;
  originalName: string;
  fullPath: string;
  fullUrl?: string;
  width?: number;
  height?: number;
  thumbPath: string;
  thumbUrl?: string;
  thumbWidth?: number;
  thumbHeight?: number;
};

export type R2GalleryIndexAlbum = {
  id: string;
  title: string;
  year: string | null;
  slug: string;
  folderId: string;
  driveFolderId: string;
  prefix: string;
  manifestPath: string;
  baseTitle: string | null;
  photoCount: number;
  coverPhoto: R2GalleryIndexPhoto | null;
  previewPhotos: R2GalleryIndexPhoto[];
};

export type R2GalleryIndex = {
  version: 1;
  source?: string;
  generatedAt?: string;
  rootPrefix?: string;
  publicBaseUrl?: string;
  albums: R2GalleryIndexAlbum[];
};

export type R2GalleryManifestPhoto = {
  sourceFileId: string;
  originalName: string;
  originalMimeType?: string;
  originalSize?: number | null;
  fullPath: string;
  fullUrl?: string;
  fullSize?: number;
  width?: number;
  height?: number;
  thumbPath: string;
  thumbUrl?: string;
  thumbSize?: number;
  thumbWidth?: number;
  thumbHeight?: number;
  contentType?: string;
};

export type R2GalleryManifest = {
  version: 1;
  name: string;
  driveFolderId: string;
  prefix: string;
  year: string | null;
  baseTitle: string | null;
  slug: string | null;
  generatedAt?: string;
  photos: R2GalleryManifestPhoto[];
};

export class R2GalleryFetchError extends Error {
  statusCode: number | null;

  constructor(message: string, statusCode: number | null = null) {
    super(message);
    this.name = 'R2GalleryFetchError';
    this.statusCode = statusCode;
  }
}

function normalizePrefix(raw: string): string {
  const prefix = raw.trim().replace(/^\/+/, '');
  if (!prefix) {
    return '';
  }
  return prefix.endsWith('/') ? prefix : `${prefix}/`;
}

function normalizeObjectPath(raw: string): string {
  return raw.trim().replace(/^\/+/, '');
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readNullableString(value: unknown): string | null {
  const text = readString(value);
  return text || null;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function normalizeSourceMode(): R2GallerySourceMode {
  const raw = (process.env.GALLERY_SOURCE ?? process.env.GALLERY_BACKEND ?? '').trim().toLowerCase();
  if (raw === 'drive' || raw === 'google' || raw === 'google-drive') {
    return 'drive';
  }
  if (raw === 'r2' || raw === 'cloudflare' || raw === 'cloudflare-r2') {
    return 'r2';
  }
  return 'auto';
}

export function isR2GalleryRequiredByEnv(): boolean {
  return normalizeSourceMode() === 'r2';
}

export function getR2GalleryConfig(): R2GalleryConfig | null {
  const sourceMode = normalizeSourceMode();
  if (sourceMode === 'drive') {
    return null;
  }

  const publicBaseUrl = (
    process.env.GALLERY_R2_PUBLIC_BASE_URL ??
    process.env.CLOUDFLARE_R2_PUBLIC_BASE_URL ??
    ''
  ).trim();
  if (!publicBaseUrl) {
    return null;
  }

  const rootPrefix = normalizePrefix(process.env.GALLERY_R2_ROOT_PREFIX ?? '');
  const indexPath = normalizeObjectPath(process.env.GALLERY_R2_INDEX_PATH?.trim() || `${rootPrefix}index.json`);
  return {
    publicBaseUrl: publicBaseUrl.replace(/\/+$/, ''),
    indexPath,
    sourceMode,
  };
}

export function getR2GalleryConfigError(): string {
  return 'Missing GALLERY_R2_PUBLIC_BASE_URL or CLOUDFLARE_R2_PUBLIC_BASE_URL environment variable.';
}

export function toR2PublicUrl(config: R2GalleryConfig, objectPath: string): string {
  const cleanPath = normalizeObjectPath(objectPath);
  return `${config.publicBaseUrl}/${cleanPath.split('/').map(encodeURIComponent).join('/')}`;
}

export async function fetchR2Json<T>(config: R2GalleryConfig, objectPath: string): Promise<T> {
  const url = toR2PublicUrl(config, objectPath);
  let response: Response;
  try {
    response = await fetch(url);
  } catch (error) {
    throw new R2GalleryFetchError(
      `Failed to fetch Cloudflare R2 gallery JSON ${objectPath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (!response.ok) {
    throw new R2GalleryFetchError(
      `Failed to fetch Cloudflare R2 gallery JSON ${objectPath}: HTTP ${response.status}`,
      response.status,
    );
  }

  try {
    return (await response.json()) as T;
  } catch (error) {
    throw new R2GalleryFetchError(
      `Failed to parse Cloudflare R2 gallery JSON ${objectPath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function normalizePhoto(raw: unknown): R2GalleryIndexPhoto | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const row = raw as Record<string, unknown>;
  const sourceFileId = readString(row.sourceFileId);
  const fullPath = readString(row.fullPath);
  const thumbPath = readString(row.thumbPath);
  if (!sourceFileId || !fullPath || !thumbPath) {
    return null;
  }

  return {
    sourceFileId,
    originalName: readString(row.originalName),
    fullPath,
    fullUrl: readString(row.fullUrl) || undefined,
    width: readNumber(row.width),
    height: readNumber(row.height),
    thumbPath,
    thumbUrl: readString(row.thumbUrl) || undefined,
    thumbWidth: readNumber(row.thumbWidth),
    thumbHeight: readNumber(row.thumbHeight),
  };
}

function normalizeAlbum(raw: unknown): R2GalleryIndexAlbum | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const row = raw as Record<string, unknown>;
  const title = readString(row.title) || readString(row.name);
  const year = readNullableString(row.year);
  const driveFolderId = readString(row.driveFolderId) || readString(row.folderId) || readString(row.id);
  const folderId = readString(row.folderId) || driveFolderId;
  const manifestPath = readString(row.manifestPath);
  if (!title || !folderId || !driveFolderId || !manifestPath) {
    return null;
  }

  const slug = readString(row.slug) || slugify(year ? `${year}-${title}` : title);
  const previewPhotos = Array.isArray(row.previewPhotos)
    ? row.previewPhotos.map(normalizePhoto).filter((photo): photo is R2GalleryIndexPhoto => Boolean(photo))
    : [];
  const coverPhoto = normalizePhoto(row.coverPhoto) ?? previewPhotos[0] ?? null;

  return {
    id: readString(row.id) || folderId,
    title,
    year,
    slug,
    folderId,
    driveFolderId,
    prefix: readString(row.prefix),
    manifestPath,
    baseTitle: readNullableString(row.baseTitle),
    photoCount: readNumber(row.photoCount) ?? previewPhotos.length,
    coverPhoto,
    previewPhotos,
  };
}

export function normalizeR2GalleryIndex(raw: unknown): R2GalleryIndex {
  if (!raw || typeof raw !== 'object') {
    throw new R2GalleryFetchError('Cloudflare R2 gallery index must be a JSON object.');
  }
  const row = raw as Record<string, unknown>;
  const albums = Array.isArray(row.albums)
    ? row.albums.map(normalizeAlbum).filter((album): album is R2GalleryIndexAlbum => Boolean(album))
    : [];

  return {
    version: 1,
    source: readString(row.source) || undefined,
    generatedAt: readString(row.generatedAt) || undefined,
    rootPrefix: readString(row.rootPrefix) || undefined,
    publicBaseUrl: readString(row.publicBaseUrl) || undefined,
    albums,
  };
}

export function normalizeR2GalleryManifest(raw: unknown): R2GalleryManifest {
  if (!raw || typeof raw !== 'object') {
    throw new R2GalleryFetchError('Cloudflare R2 gallery manifest must be a JSON object.');
  }
  const row = raw as Record<string, unknown>;
  const driveFolderId = readString(row.driveFolderId);
  const photos: R2GalleryManifestPhoto[] = [];
  if (Array.isArray(row.photos)) {
    for (const photo of row.photos) {
      const normalized = normalizePhoto(photo);
      if (!normalized || !photo || typeof photo !== 'object') {
        continue;
      }
      const photoRow = photo as Record<string, unknown>;
      photos.push({
        ...normalized,
        originalMimeType: readString(photoRow.originalMimeType) || undefined,
        originalSize: readNumber(photoRow.originalSize) ?? null,
        fullSize: readNumber(photoRow.fullSize),
        thumbSize: readNumber(photoRow.thumbSize),
        contentType: readString(photoRow.contentType) || undefined,
      });
    }
  }

  return {
    version: 1,
    name: readString(row.name),
    driveFolderId,
    prefix: readString(row.prefix),
    year: readNullableString(row.year),
    baseTitle: readNullableString(row.baseTitle),
    slug: readNullableString(row.slug),
    generatedAt: readString(row.generatedAt) || undefined,
    photos,
  };
}
