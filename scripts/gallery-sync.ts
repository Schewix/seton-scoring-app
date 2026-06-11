import { S3Client, GetObjectCommand, HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import dotenv from 'dotenv';
import { google, type drive_v3 } from 'googleapis';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import sharp from 'sharp';

type GalleryConfig = {
  name: string;
  driveFolderId: string;
  prefix: string;
  year?: string;
  baseTitle?: string;
  slug?: string;
};

type WebGalleryConfig = {
  rootFolderId?: string;
  targetRootPrefix: string;
  albumAllowlist: string[];
  years: string[];
};

type SyncConfig = {
  galleries: GalleryConfig[];
  webGallery: WebGalleryConfig | null;
};

type GalleryManifestPhoto = {
  sourceFileId: string;
  originalName: string;
  originalMimeType: string;
  originalSize: number | null;
  fullPath: string;
  fullUrl: string;
  fullSize: number;
  width: number;
  height: number;
  thumbPath: string;
  thumbUrl: string;
  thumbSize: number;
  thumbWidth: number;
  thumbHeight: number;
  contentType: 'image/webp';
};

type GalleryManifest = {
  version: 1;
  name: string;
  driveFolderId: string;
  prefix: string;
  year: string | null;
  baseTitle: string | null;
  slug: string | null;
  generatedAt: string;
  photos: GalleryManifestPhoto[];
};

type GalleryIndexPhoto = Pick<
  GalleryManifestPhoto,
  | 'sourceFileId'
  | 'originalName'
  | 'fullPath'
  | 'fullUrl'
  | 'width'
  | 'height'
  | 'thumbPath'
  | 'thumbUrl'
  | 'thumbWidth'
  | 'thumbHeight'
>;

type GalleryIndexAlbum = {
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
  coverPhoto: GalleryIndexPhoto | null;
  previewPhotos: GalleryIndexPhoto[];
};

type GalleryIndex = {
  version: 1;
  source: 'cloudflare-r2';
  generatedAt: string;
  rootPrefix: string;
  publicBaseUrl: string;
  albums: GalleryIndexAlbum[];
};

type DriveImage = {
  id: string;
  name: string;
  mimeType: string;
  size: number | null;
};

type DriveFolder = {
  id: string;
  name: string;
};

type DiscoveredDriveFolder = DriveFolder & {
  pathParts: string[];
  ancestorIds: string[];
};

type SyncStats = {
  found: number;
  uploaded: number;
  skipped: number;
  unsupported: number;
  errors: number;
};

type CliOptions = {
  configPath: string;
  force: boolean;
};

const DEFAULT_CONFIG_PATH = 'gallery-sync.config.json';
const SUPPORTED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const SUPPORTED_EXTENSIONS = new Set(['.jpg', '.jpeg', '.jfif', '.png', '.webp']);
const FOLDER_MIME_TYPE = 'application/vnd.google-apps.folder';
const SHORTCUT_MIME_TYPE = 'application/vnd.google-apps.shortcut';
const DEFAULT_DRIVE_DOWNLOAD_DELAY_MS = 250;
const DEFAULT_DRIVE_DOWNLOAD_RETRIES = 3;
const DEFAULT_DRIVE_DOWNLOAD_RETRY_DELAY_MS = 5000;
const MAX_DRIVE_DOWNLOAD_RETRY_DELAY_MS = 60000;
const RETRYABLE_DRIVE_DOWNLOAD_REASONS = new Set([
  'rateLimitExceeded',
  'userRateLimitExceeded',
]);
const NON_RETRYABLE_DRIVE_DOWNLOAD_REASONS = new Set([
  'dailyLimitExceeded',
  'downloadQuotaExceeded',
  'fileNotDownloadable',
  'insufficientFilePermissions',
]);

type DriveDownloadSettings = {
  delayMs: number;
  retries: number;
  retryDelayMs: number;
  maxRetryDelayMs: number;
};

type GoogleApiErrorDetails = {
  statusCode: number | null;
  reasons: string[];
  message: string | null;
  retryAfterMs: number | null;
};

function loadEnvFiles() {
  const candidates = [
    path.resolve(process.cwd(), '.env'),
    path.resolve(process.cwd(), '.env.local'),
    path.resolve(process.cwd(), '../.env'),
    path.resolve(process.cwd(), '../.env.local'),
  ];

  for (const filePath of candidates) {
    if (fs.existsSync(filePath)) {
      dotenv.config({ path: filePath, override: false });
    }
  }
}

function printHelp() {
  console.log(`Usage: npm run gallery:sync -- [options]

Options:
  --config <path>  Path to gallery sync JSON config. Default: ${DEFAULT_CONFIG_PATH}
  --force          Regenerate and upload images even when R2 objects already exist.
  --help           Show this help.
`);
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    configPath: DEFAULT_CONFIG_PATH,
    force: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
    if (arg === '--force') {
      options.force = true;
      continue;
    }
    if (arg === '--config') {
      const value = argv[index + 1];
      if (!value) {
        throw new Error('Missing value for --config.');
      }
      options.configPath = value;
      index += 1;
      continue;
    }
    if (arg.startsWith('--config=')) {
      options.configPath = arg.slice('--config='.length);
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing ${name} environment variable.`);
  }
  return value;
}

function optionalEnv(name: string): string | null {
  const value = process.env[name]?.trim();
  return value || null;
}

function readIntegerEnv(name: string, fallback: number, min: number, max: number): number {
  const rawValue = process.env[name]?.trim();
  if (!rawValue) {
    return fallback;
  }
  const parsed = Number(rawValue);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}.`);
  }
  return parsed;
}

function getDriveDownloadSettings(): DriveDownloadSettings {
  return {
    delayMs: readIntegerEnv('GOOGLE_DRIVE_DOWNLOAD_DELAY_MS', DEFAULT_DRIVE_DOWNLOAD_DELAY_MS, 0, 60000),
    retries: readIntegerEnv('GOOGLE_DRIVE_DOWNLOAD_RETRIES', DEFAULT_DRIVE_DOWNLOAD_RETRIES, 0, 10),
    retryDelayMs: readIntegerEnv(
      'GOOGLE_DRIVE_DOWNLOAD_RETRY_DELAY_MS',
      DEFAULT_DRIVE_DOWNLOAD_RETRY_DELAY_MS,
      100,
      300000,
    ),
    maxRetryDelayMs: readIntegerEnv(
      'GOOGLE_DRIVE_DOWNLOAD_MAX_RETRY_DELAY_MS',
      MAX_DRIVE_DOWNLOAD_RETRY_DELAY_MS,
      100,
      300000,
    ),
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function readTextFileIfExists(rawPath: string): string | null {
  const candidates = [
    path.resolve(process.cwd(), rawPath),
    path.resolve(process.cwd(), '..', rawPath),
  ];

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        return fs.readFileSync(candidate, 'utf8');
      }
    } catch {
      // The env value may be raw/base64 JSON rather than a path.
    }
  }

  return null;
}

function decodeBase64(value: string): string | null {
  try {
    return Buffer.from(value, 'base64').toString('utf8');
  } catch {
    return null;
  }
}

function readServiceAccountJson() {
  const rawValue = optionalEnv('GOOGLE_SERVICE_ACCOUNT_JSON');
  if (!rawValue) {
    return null;
  }

  const rawJson = rawValue.trim().startsWith('{')
    ? rawValue
    : readTextFileIfExists(rawValue) ?? decodeBase64(rawValue) ?? rawValue;

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch (error) {
    throw new Error(
      `GOOGLE_SERVICE_ACCOUNT_JSON must be raw JSON, base64 JSON, or a readable JSON file path. ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON does not contain a JSON object.');
  }

  const clientEmail = (parsed as { client_email?: unknown }).client_email;
  const privateKey = (parsed as { private_key?: unknown }).private_key;
  if (typeof clientEmail !== 'string' || !clientEmail.trim()) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is missing client_email.');
  }
  if (typeof privateKey !== 'string' || !privateKey.trim()) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is missing private_key.');
  }

  return {
    clientEmail: clientEmail.trim(),
    privateKey: privateKey.replace(/\\n/g, '\n'),
  };
}

function createDriveClient(): drive_v3.Drive {
  const serviceAccount = readServiceAccountJson();
  if (serviceAccount) {
    const auth = new google.auth.JWT({
      email: serviceAccount.clientEmail,
      key: serviceAccount.privateKey,
      scopes: ['https://www.googleapis.com/auth/drive.readonly'],
    });
    return google.drive({ version: 'v3', auth });
  }

  const apiKey = optionalEnv('GOOGLE_DRIVE_API_KEY') ?? optionalEnv('GOOGLE_API_KEY');
  if (apiKey) {
    console.log('GOOGLE_SERVICE_ACCOUNT_JSON not set. Using GOOGLE_DRIVE_API_KEY for public Google Drive access.');
    return google.drive({ version: 'v3', auth: apiKey });
  }

  throw new Error(
    'Missing Google Drive credentials. Public Google Drive folders do not need GOOGLE_SERVICE_ACCOUNT_JSON, '
      + 'but Google Drive API still requires GOOGLE_DRIVE_API_KEY to list and download public folders.',
  );
}

function createR2Client() {
  const accountId = requireEnv('CLOUDFLARE_R2_ACCOUNT_ID');
  const accessKeyId = requireEnv('CLOUDFLARE_R2_ACCESS_KEY_ID');
  const secretAccessKey = requireEnv('CLOUDFLARE_R2_SECRET_ACCESS_KEY');

  return new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
  });
}

function normalizePrefix(raw: string): string {
  const prefix = raw.trim().replace(/^\/+/, '');
  if (!prefix) {
    return '';
  }
  return prefix.endsWith('/') ? prefix : `${prefix}/`;
}

function normalizeObjectKey(raw: string): string {
  return raw.trim().replace(/^\/+/, '');
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

function normalizeAllowlist(raw: unknown, fallbackRaw = ''): string[] {
  if (Array.isArray(raw)) {
    return raw
      .map((item) => (typeof item === 'string' ? item.trim() : ''))
      .filter(Boolean)
      .map(normalizeForMatch);
  }
  if (typeof raw === 'string') {
    return parseAlbumAllowlist(raw);
  }
  return parseAlbumAllowlist(fallbackRaw);
}

function isAlbumAllowedByAllowlist(albumName: string, allowlist: string[]): boolean {
  if (allowlist.length === 0) {
    return true;
  }
  const normalizedName = normalizeForMatch(albumName);
  return allowlist.some((term) => normalizedName.includes(term));
}

function sortYearLabel(value: string) {
  const match = value.match(/\d{4}/);
  if (match) {
    return Number(match[0]);
  }
  return Number.NEGATIVE_INFINITY;
}

function parseYears(raw: unknown): string[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw
    .map((item) => (typeof item === 'string' || typeof item === 'number' ? String(item).trim() : ''))
    .filter(Boolean);
}

function parseGalleryEntries(raw: unknown): GalleryConfig[] {
  const entries = Array.isArray(raw)
    ? raw
    : raw && typeof raw === 'object' && Array.isArray((raw as { galleries?: unknown }).galleries)
      ? (raw as { galleries: unknown[] }).galleries
      : null;

  if (!entries) {
    throw new Error('Gallery config must be an array or an object with a galleries array.');
  }

  return entries.map((entry, index) => {
    if (!entry || typeof entry !== 'object') {
      throw new Error(`Gallery config item ${index + 1} must be an object.`);
    }
    const row = entry as Record<string, unknown>;
    const name = typeof row.name === 'string' ? row.name.trim() : '';
    const driveFolderId =
      typeof row.driveFolderId === 'string'
        ? row.driveFolderId.trim()
        : typeof row.googleDriveFolderId === 'string'
          ? row.googleDriveFolderId.trim()
          : typeof row.folderId === 'string'
            ? row.folderId.trim()
            : '';
    const prefix =
      typeof row.prefix === 'string'
        ? row.prefix
        : typeof row.targetPrefix === 'string'
          ? row.targetPrefix
          : '';

    if (!name) {
      throw new Error(`Gallery config item ${index + 1} is missing name.`);
    }
    if (!driveFolderId) {
      throw new Error(`Gallery "${name}" is missing driveFolderId.`);
    }
    const normalizedPrefix = normalizePrefix(prefix);
    if (!normalizedPrefix) {
      throw new Error(`Gallery "${name}" is missing prefix.`);
    }

    return {
      name,
      driveFolderId,
      prefix: normalizedPrefix,
    };
  });
}

function parseWebGalleryConfig(raw: Record<string, unknown>): WebGalleryConfig | null {
  const nested = raw.webGallery && typeof raw.webGallery === 'object' && !Array.isArray(raw.webGallery)
    ? (raw.webGallery as Record<string, unknown>)
    : null;
  const source = typeof raw.source === 'string' ? raw.source.trim().toLowerCase() : '';

  if (!nested && source !== 'web-gallery') {
    return null;
  }

  const row = nested ?? raw;
  const rootFolderId =
    typeof row.rootFolderId === 'string'
      ? row.rootFolderId.trim()
      : typeof row.googleDriveRootFolderId === 'string'
        ? row.googleDriveRootFolderId.trim()
        : undefined;
  const targetRootPrefix =
    typeof row.targetRootPrefix === 'string'
      ? row.targetRootPrefix
      : typeof row.prefix === 'string'
        ? row.prefix
        : process.env.GALLERY_R2_ROOT_PREFIX ?? '';

  return {
    rootFolderId,
    targetRootPrefix: normalizePrefix(targetRootPrefix),
    albumAllowlist: normalizeAllowlist(row.albumAllowlist, process.env.GOOGLE_DRIVE_ALBUM_NAME_ALLOWLIST ?? ''),
    years: parseYears(row.years),
  };
}

function loadSyncConfig(configPath: string): SyncConfig {
  const resolvedPath = path.resolve(process.cwd(), configPath);
  if (!fs.existsSync(resolvedPath)) {
    if (process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID?.trim()) {
      console.log(`Gallery config not found: ${resolvedPath}. Using web gallery discovery from GOOGLE_DRIVE_ROOT_FOLDER_ID.`);
      return {
        galleries: [],
        webGallery: {
          rootFolderId: process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID.trim(),
          targetRootPrefix: normalizePrefix(process.env.GALLERY_R2_ROOT_PREFIX ?? ''),
          albumAllowlist: parseAlbumAllowlist(process.env.GOOGLE_DRIVE_ALBUM_NAME_ALLOWLIST ?? ''),
          years: [],
        },
      };
    }
    throw new Error(`Gallery config not found: ${resolvedPath}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(resolvedPath, 'utf8'));
  } catch (error) {
      throw new Error(`Failed to parse gallery config ${resolvedPath}: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (Array.isArray(parsed)) {
    return { galleries: parseGalleryEntries(parsed), webGallery: null };
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Gallery config must be a JSON object or array.');
  }

  const row = parsed as Record<string, unknown>;
  return {
    galleries: Array.isArray(row.galleries) ? parseGalleryEntries(row.galleries) : [],
    webGallery: parseWebGalleryConfig(row),
  };
}

function isSupportedImage(name: string, mimeType: string): boolean {
  return SUPPORTED_MIME_TYPES.has(mimeType)
    || (mimeType.startsWith('image/') && SUPPORTED_EXTENSIONS.has(path.extname(name).toLowerCase()));
}

function slugifyBaseName(name: string, fallback: string): string {
  const ext = path.extname(name);
  const baseName = (ext ? name.slice(0, -ext.length) : name)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return baseName || fallback;
}

function shortId(id: string): string {
  return id.replace(/[^a-zA-Z0-9]/g, '').slice(0, 8) || 'file';
}

function buildOutputNames(files: DriveImage[]): Map<string, string> {
  const baseNameCounts = new Map<string, number>();
  for (const file of files) {
    const baseName = slugifyBaseName(file.name, `photo-${shortId(file.id)}`);
    baseNameCounts.set(baseName, (baseNameCounts.get(baseName) ?? 0) + 1);
  }

  const names = new Map<string, string>();
  for (const file of files) {
    const baseName = slugifyBaseName(file.name, `photo-${shortId(file.id)}`);
    const uniqueBaseName = (baseNameCounts.get(baseName) ?? 0) > 1 ? `${baseName}-${shortId(file.id)}` : baseName;
    names.set(file.id, `${uniqueBaseName}.webp`);
  }
  return names;
}

function publicUrl(publicBaseUrl: string, key: string): string {
  return `${publicBaseUrl.replace(/\/+$/, '')}/${key.split('/').map(encodeURIComponent).join('/')}`;
}

function manifestComparable(manifest: GalleryManifest): string {
  return JSON.stringify({
    version: manifest.version,
    name: manifest.name,
    driveFolderId: manifest.driveFolderId,
    prefix: manifest.prefix,
    year: manifest.year,
    baseTitle: manifest.baseTitle,
    slug: manifest.slug,
    photos: manifest.photos,
  });
}

function galleryIndexComparable(index: GalleryIndex): string {
  return JSON.stringify({
    version: index.version,
    source: index.source,
    rootPrefix: index.rootPrefix,
    publicBaseUrl: index.publicBaseUrl,
    albums: index.albums,
  });
}

async function validateDriveFolder(drive: drive_v3.Drive, gallery: GalleryConfig) {
  try {
    const { data } = await drive.files.get({
      fileId: gallery.driveFolderId,
      fields: 'id,name,mimeType',
      supportsAllDrives: true,
    });

    if (data.mimeType !== FOLDER_MIME_TYPE) {
      throw new Error(`Google Drive ID ${gallery.driveFolderId} is not a folder.`);
    }
  } catch (error) {
    throw new Error(
      `Failed to open Google Drive folder for "${gallery.name}" (${gallery.driveFolderId}). ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

function driveListOptions() {
  const sharedDriveId = process.env.GOOGLE_DRIVE_SHARED_DRIVE_ID?.trim();
  if (!sharedDriveId) {
    return {};
  }
  return { corpora: 'drive', driveId: sharedDriveId };
}

async function listDriveFolders(drive: drive_v3.Drive, parentId: string): Promise<DriveFolder[]> {
  const folders: DriveFolder[] = [];
  let pageToken: string | undefined;

  do {
    const { data } = await drive.files.list({
      q: `'${parentId}' in parents and (mimeType = '${FOLDER_MIME_TYPE}' or mimeType = '${SHORTCUT_MIME_TYPE}') and trashed = false`,
      fields: 'nextPageToken, files(id,name,mimeType,shortcutDetails(targetId,targetMimeType))',
      pageSize: 1000,
      pageToken,
      includeItemsFromAllDrives: true,
      supportsAllDrives: true,
      ...driveListOptions(),
    });

    for (const file of data.files ?? []) {
      if (file.mimeType === FOLDER_MIME_TYPE && file.id && file.name) {
        folders.push({ id: file.id, name: file.name });
        continue;
      }
      if (
        file.mimeType === SHORTCUT_MIME_TYPE &&
        file.shortcutDetails?.targetMimeType === FOLDER_MIME_TYPE &&
        file.shortcutDetails.targetId &&
        file.name
      ) {
        folders.push({ id: file.shortcutDetails.targetId, name: file.name });
      }
    }

    pageToken = data.nextPageToken ?? undefined;
  } while (pageToken);

  folders.sort((a, b) => a.name.localeCompare(b.name, 'cs'));
  return folders;
}

async function listDriveFolderTree(drive: drive_v3.Drive, parentId: string): Promise<DiscoveredDriveFolder[]> {
  const seen = new Set<string>([parentId]);
  const queue: Array<{ parentId: string; pathParts: string[]; ancestorIds: string[] }> = [
    { parentId, pathParts: [], ancestorIds: [] },
  ];
  const folders: DiscoveredDriveFolder[] = [];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      continue;
    }

    const children = await listDriveFolders(drive, current.parentId);
    for (const child of children) {
      if (seen.has(child.id)) {
        continue;
      }

      seen.add(child.id);
      const pathParts = [...current.pathParts, child.name];
      const ancestorIds = current.pathParts.length > 0
        ? [...current.ancestorIds, current.parentId]
        : [];
      const folder: DiscoveredDriveFolder = {
        ...child,
        pathParts,
        ancestorIds,
      };

      folders.push(folder);
      queue.push({
        parentId: child.id,
        pathParts,
        ancestorIds,
      });
    }
  }

  return folders;
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

async function listDriveFiles(
  drive: drive_v3.Drive,
  gallery: GalleryConfig,
  folderIds: string[],
  stats: SyncStats,
): Promise<DriveImage[]> {
  const files: DriveImage[] = [];
  const seenFileIds = new Set<string>();

  for (const folderChunk of chunkArray(folderIds, 50)) {
    const parentsQuery = folderChunk.map((id) => `'${id}' in parents`).join(' or ');
    let pageToken: string | undefined;

    do {
      const { data } = await drive.files.list({
        q: `(${parentsQuery}) and trashed = false`,
        fields:
          'nextPageToken, files(id,name,mimeType,size,shortcutDetails(targetId,targetMimeType))',
        pageSize: 1000,
        pageToken,
        includeItemsFromAllDrives: true,
        supportsAllDrives: true,
        ...driveListOptions(),
      });

      for (const file of data.files ?? []) {
        if (!file.id || !file.name || !file.mimeType) {
          continue;
        }
        if (file.mimeType === FOLDER_MIME_TYPE) {
          continue;
        }

        const isShortcut = file.mimeType === SHORTCUT_MIME_TYPE;
        const id = isShortcut ? file.shortcutDetails?.targetId : file.id;
        const mimeType = isShortcut ? file.shortcutDetails?.targetMimeType : file.mimeType;
        if (!id || !mimeType || !isSupportedImage(file.name, mimeType)) {
          stats.unsupported += 1;
          console.warn(`[${gallery.name}] Skipping unsupported file: ${file.name} (${mimeType ?? file.mimeType})`);
          continue;
        }
        if (seenFileIds.has(id)) {
          continue;
        }
        seenFileIds.add(id);

        files.push({
          id,
          name: file.name,
          mimeType,
          size: file.size ? Number(file.size) : null,
        });
      }

      pageToken = data.nextPageToken ?? undefined;
    } while (pageToken);
  }

  files.sort((a, b) => a.name.localeCompare(b.name, 'cs') || a.id.localeCompare(b.id));
  return files;
}

function folderPathLabel(folder: DiscoveredDriveFolder): string {
  return folder.pathParts.join(' / ');
}

function isFolderAllowedByAllowlist(folder: DiscoveredDriveFolder, allowlist: string[]): boolean {
  return isAlbumAllowedByAllowlist(folder.name, allowlist)
    || isAlbumAllowedByAllowlist(folderPathLabel(folder), allowlist);
}

function slugifyPathParts(pathParts: string[], fallback: string, separator: '/' | '-'): string {
  const slugParts = pathParts
    .map((part, index) => slugifyBaseName(part, `${fallback}-${index + 1}`))
    .filter(Boolean);
  return slugParts.join(separator) || fallback;
}

function selectWebGalleryAlbumFolders(
  folderTree: DiscoveredDriveFolder[],
  allowlist: string[],
): DiscoveredDriveFolder[] {
  const candidates = allowlist.length > 0
    ? folderTree.filter((folder) => isFolderAllowedByAllowlist(folder, allowlist))
    : folderTree.filter((folder) => folder.pathParts.length === 1);

  const selected: DiscoveredDriveFolder[] = [];
  const selectedIds = new Set<string>();
  for (const candidate of candidates.sort((a, b) => {
    if (a.pathParts.length !== b.pathParts.length) {
      return a.pathParts.length - b.pathParts.length;
    }
    return folderPathLabel(a).localeCompare(folderPathLabel(b), 'cs');
  })) {
    if (candidate.ancestorIds.some((id) => selectedIds.has(id))) {
      continue;
    }
    selected.push(candidate);
    selectedIds.add(candidate.id);
  }

  return selected;
}

async function discoverWebGalleryAlbums(drive: drive_v3.Drive, config: WebGalleryConfig): Promise<GalleryConfig[]> {
  const rootFolderId = config.rootFolderId?.trim() || requireEnv('GOOGLE_DRIVE_ROOT_FOLDER_ID');
  const rootGallery: GalleryConfig = {
    name: 'Google Drive gallery root',
    driveFolderId: rootFolderId,
    prefix: config.targetRootPrefix,
  };
  await validateDriveFolder(drive, rootGallery);

  const yearFolders = await listDriveFolders(drive, rootFolderId);
  const scopedYears = config.years.length > 0
    ? yearFolders.filter((folder) => config.years.includes(folder.name))
    : yearFolders;
  const galleries: GalleryConfig[] = [];

  console.log(`Web gallery discovery: ${scopedYears.length} year folder(s), allowlist: ${config.albumAllowlist.length || 'none'}.`);

  for (const yearFolder of scopedYears) {
    const folderTree = await listDriveFolderTree(drive, yearFolder.id);
    const albumFolders = selectWebGalleryAlbumFolders(folderTree, config.albumAllowlist);
    console.log(
      `Web gallery discovery: ${yearFolder.name}: selected ${albumFolders.length} album folder(s) from ${folderTree.length} folder(s).`,
    );

    for (const albumFolder of albumFolders) {
      const yearSlug = slugifyBaseName(yearFolder.name, yearFolder.id);
      const albumSlug = slugifyPathParts(albumFolder.pathParts, albumFolder.id, '-');
      const albumPrefix = slugifyPathParts(albumFolder.pathParts, albumFolder.id, '/');
      const slug = yearSlug ? `${yearSlug}-${albumSlug}` : albumSlug;
      galleries.push({
        name: albumFolder.name,
        driveFolderId: albumFolder.id,
        prefix: `${config.targetRootPrefix}${yearSlug}/${albumPrefix}/`,
        year: yearFolder.name,
        baseTitle: folderPathLabel(albumFolder),
        slug,
      });
    }
  }

  galleries.sort((a, b) => {
    const yearA = sortYearLabel(a.year ?? '');
    const yearB = sortYearLabel(b.year ?? '');
    if (yearA !== yearB) {
      return yearB - yearA;
    }
    if ((a.year ?? '') !== (b.year ?? '')) {
      return (b.year ?? '').localeCompare(a.year ?? '', 'cs');
    }
    return a.name.localeCompare(b.name, 'cs');
  });

  console.log(`Web gallery discovery: ${galleries.length} album(s) selected for sync.`);
  return galleries;
}

async function objectExists(s3: S3Client, bucket: string, key: string): Promise<boolean> {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return true;
  } catch (error) {
    const statusCode = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
    if (statusCode === 404) {
      return false;
    }
    throw error;
  }
}

async function getObjectText(s3: S3Client, bucket: string, key: string): Promise<string | null> {
  try {
    const response = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    return (await response.Body?.transformToString()) ?? null;
  } catch (error) {
    const statusCode = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
    if (statusCode === 404) {
      return null;
    }
    throw error;
  }
}

async function loadExistingManifest(s3: S3Client, bucket: string, key: string): Promise<GalleryManifest | null> {
  const body = await getObjectText(s3, bucket, key);
  if (!body) {
    return null;
  }

  try {
    return JSON.parse(body) as GalleryManifest;
  } catch (error) {
    console.warn(`[manifest] Existing manifest ${key} is not valid JSON and will be replaced: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

function headerValue(headers: unknown, name: string): string | null {
  if (!headers || typeof headers !== 'object') {
    return null;
  }

  const getter = (headers as { get?: unknown }).get;
  if (typeof getter === 'function') {
    const value = getter.call(headers, name);
    return typeof value === 'string' ? value : null;
  }

  const lowerName = name.toLowerCase();
  for (const [key, value] of Object.entries(headers as Record<string, unknown>)) {
    if (key.toLowerCase() !== lowerName) {
      continue;
    }
    if (Array.isArray(value)) {
      return value.map(String).join(', ');
    }
    return typeof value === 'string' || typeof value === 'number' ? String(value) : null;
  }

  return null;
}

function parseRetryAfterMs(headers: unknown): number | null {
  const retryAfter = headerValue(headers, 'retry-after');
  if (!retryAfter) {
    return null;
  }

  const seconds = Number(retryAfter);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return seconds * 1000;
  }

  const retryDate = Date.parse(retryAfter);
  if (Number.isFinite(retryDate)) {
    return Math.max(0, retryDate - Date.now());
  }

  return null;
}

function responseDataToText(data: unknown): string | null {
  if (!data) {
    return null;
  }
  if (typeof data === 'string') {
    return data;
  }
  if (Buffer.isBuffer(data)) {
    return data.toString('utf8');
  }
  if (data instanceof ArrayBuffer) {
    return Buffer.from(data).toString('utf8');
  }
  if (ArrayBuffer.isView(data)) {
    return Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString('utf8');
  }
  return null;
}

function parseResponsePayload(data: unknown): Record<string, unknown> | null {
  if (!data) {
    return null;
  }
  if (typeof data === 'object' && !Buffer.isBuffer(data) && !(data instanceof ArrayBuffer) && !ArrayBuffer.isView(data)) {
    return data as Record<string, unknown>;
  }

  const text = responseDataToText(data);
  if (!text) {
    return null;
  }
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : null;
  } catch {
    return { message: text.slice(0, 300) };
  }
}

function extractGoogleApiErrorDetails(error: unknown): GoogleApiErrorDetails {
  const rawError = error as {
    code?: unknown;
    message?: unknown;
    response?: {
      status?: unknown;
      data?: unknown;
      headers?: unknown;
    };
    errors?: unknown;
  };
  const response = rawError.response;
  const statusCode =
    typeof response?.status === 'number'
      ? response.status
      : typeof rawError.code === 'number'
        ? rawError.code
        : null;
  const payload = parseResponsePayload(response?.data);
  const payloadError = payload?.error && typeof payload.error === 'object'
    ? payload.error as Record<string, unknown>
    : null;
  const rawErrors = Array.isArray(payloadError?.errors)
    ? payloadError.errors
    : Array.isArray(payload?.errors)
      ? payload.errors
      : Array.isArray(rawError.errors)
        ? rawError.errors
        : [];
  const reasons = [...new Set(rawErrors
    .map((item) => (item && typeof item === 'object' ? (item as { reason?: unknown }).reason : null))
    .filter((reason): reason is string => typeof reason === 'string' && reason.length > 0))];
  const payloadMessage =
    typeof payloadError?.message === 'string'
      ? payloadError.message
      : typeof payload?.message === 'string'
        ? payload.message
        : null;
  const message = payloadMessage || (typeof rawError.message === 'string' ? rawError.message : null);

  return {
    statusCode,
    reasons,
    message,
    retryAfterMs: parseRetryAfterMs(response?.headers),
  };
}

function summarizeGoogleApiError(error: unknown): string {
  const details = extractGoogleApiErrorDetails(error);
  const parts: string[] = [];
  if (details.statusCode) {
    parts.push(`HTTP ${details.statusCode}`);
  }
  if (details.reasons.length > 0) {
    parts.push(`reason=${details.reasons.join(',')}`);
  }
  if (details.message) {
    parts.push(`message="${details.message}"`);
  }
  return parts.join(' ') || (error instanceof Error ? error.message : String(error));
}

function isRetryableDriveDownloadError(error: unknown): boolean {
  const details = extractGoogleApiErrorDetails(error);
  const code = (error as { code?: unknown }).code;
  if (typeof code === 'string' && ['ECONNRESET', 'ETIMEDOUT', 'ECONNABORTED', 'EAI_AGAIN'].includes(code)) {
    return true;
  }
  if (!details.statusCode) {
    return false;
  }
  if (details.statusCode === 429 || details.statusCode >= 500) {
    return true;
  }
  if (details.statusCode !== 403) {
    return false;
  }
  if (details.reasons.some((reason) => NON_RETRYABLE_DRIVE_DOWNLOAD_REASONS.has(reason))) {
    return false;
  }
  if (details.reasons.length === 0) {
    return true;
  }
  return details.reasons.some((reason) => RETRYABLE_DRIVE_DOWNLOAD_REASONS.has(reason));
}

function retryDelayMs(error: unknown, retryIndex: number, settings: DriveDownloadSettings): number {
  const details = extractGoogleApiErrorDetails(error);
  if (details.retryAfterMs !== null) {
    return Math.min(details.retryAfterMs, settings.maxRetryDelayMs);
  }
  return Math.min(settings.retryDelayMs * (2 ** retryIndex), settings.maxRetryDelayMs);
}

async function downloadDriveFile(
  drive: drive_v3.Drive,
  file: DriveImage,
  galleryName: string,
  settings: DriveDownloadSettings,
): Promise<Buffer> {
  for (let attempt = 0; attempt <= settings.retries; attempt += 1) {
    if (settings.delayMs > 0) {
      await sleep(settings.delayMs);
    }

    try {
      const response = await drive.files.get(
        {
          fileId: file.id,
          alt: 'media',
          supportsAllDrives: true,
        },
        { responseType: 'arraybuffer' },
      );

      return Buffer.from(response.data as ArrayBuffer);
    } catch (error) {
      const summary = summarizeGoogleApiError(error);
      if (attempt >= settings.retries || !isRetryableDriveDownloadError(error)) {
        throw new Error(`Google Drive download failed for ${file.name}: ${summary}`);
      }

      const delayMs = retryDelayMs(error, attempt, settings);
      console.warn(
        `[${galleryName}] Download failed for ${file.name}: ${summary}. Retry ${attempt + 1}/${settings.retries} in ${Math.round(delayMs / 1000)}s.`,
      );
      await sleep(delayMs);
    }
  }

  throw new Error(`Google Drive download failed for ${file.name}.`);
}

async function optimizeImage(input: Buffer) {
  const fullBuffer = await sharp(input)
    .rotate()
    .resize({ width: 2000, withoutEnlargement: true })
    .webp({ quality: 82, effort: 5 })
    .toBuffer();

  const thumbBuffer = await sharp(input)
    .rotate()
    .resize({ width: 500, withoutEnlargement: true })
    .webp({ quality: 75, effort: 5 })
    .toBuffer();

  const [fullMetadata, thumbMetadata] = await Promise.all([
    sharp(fullBuffer).metadata(),
    sharp(thumbBuffer).metadata(),
  ]);

  if (!fullMetadata.width || !fullMetadata.height || !thumbMetadata.width || !thumbMetadata.height) {
    throw new Error('Failed to read optimized image dimensions.');
  }

  return {
    fullBuffer,
    thumbBuffer,
    fullWidth: fullMetadata.width,
    fullHeight: fullMetadata.height,
    thumbWidth: thumbMetadata.width,
    thumbHeight: thumbMetadata.height,
  };
}

async function uploadObject(params: {
  s3: S3Client;
  bucket: string;
  key: string;
  body: Buffer | string;
  contentType: string;
  cacheControl: string;
}) {
  try {
    await params.s3.send(
      new PutObjectCommand({
        Bucket: params.bucket,
        Key: params.key,
        Body: params.body,
        ContentType: params.contentType,
        CacheControl: params.cacheControl,
      }),
    );
  } catch (error) {
    throw new Error(`Failed to upload ${params.key} to R2: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function syncGallery(params: {
  gallery: GalleryConfig;
  drive: drive_v3.Drive;
  s3: S3Client;
  bucket: string;
  publicBaseUrl: string;
  force: boolean;
  driveDownloadSettings: DriveDownloadSettings;
}): Promise<{ stats: SyncStats; manifest: GalleryManifest; manifestKey: string }> {
  const { gallery, drive, s3, bucket, publicBaseUrl, force, driveDownloadSettings } = params;
  const stats: SyncStats = { found: 0, uploaded: 0, skipped: 0, unsupported: 0, errors: 0 };

  console.log(`\n[${gallery.name}] Checking Google Drive folder ${gallery.driveFolderId}`);
  await validateDriveFolder(drive, gallery);

  const descendantFolders = await listDriveFolderTree(drive, gallery.driveFolderId);
  const folderIds = [gallery.driveFolderId, ...descendantFolders.map((folder) => folder.id)];
  const files = await listDriveFiles(drive, gallery, folderIds, stats);
  stats.found = files.length;
  console.log(
    `[${gallery.name}] Found ${files.length} supported image(s) across ${folderIds.length} folder(s), skipped ${stats.unsupported} unsupported item(s).`,
  );
  if (files.length === 0 && descendantFolders.length > 0) {
    const listedFolders = descendantFolders
      .slice(0, 20)
      .map(folderPathLabel)
      .join('; ');
    const suffix = descendantFolders.length > 20 ? `; ... ${descendantFolders.length - 20} more` : '';
    console.warn(`[${gallery.name}] No supported images found. Scanned descendant folders: ${listedFolders}${suffix}`);
  }

  const outputNames = buildOutputNames(files);
  const manifestKey = `${gallery.prefix}manifest.json`;
  const existingManifest = await loadExistingManifest(s3, bucket, manifestKey);
  const existingPhotosByFileId = new Map(
    (existingManifest?.photos ?? []).map((photo) => [photo.sourceFileId, photo] as const),
  );
  const photos: GalleryManifestPhoto[] = [];

  for (const file of files) {
    const outputName = outputNames.get(file.id);
    if (!outputName) {
      stats.errors += 1;
      console.error(`[${gallery.name}] Failed to build output name for ${file.name}.`);
      continue;
    }

    const fullPath = `${gallery.prefix}full/${outputName}`;
    const thumbPath = `${gallery.prefix}thumb/${outputName}`;

    try {
      const [fullExists, thumbExists] = await Promise.all([
        objectExists(s3, bucket, fullPath),
        objectExists(s3, bucket, thumbPath),
      ]);
      const existingPhoto = existingPhotosByFileId.get(file.id);

      if (!force && fullExists && thumbExists && existingPhoto) {
        stats.skipped += 1;
        photos.push({
          ...existingPhoto,
          originalName: file.name,
          originalMimeType: file.mimeType,
          originalSize: file.size,
          fullPath,
          fullUrl: publicUrl(publicBaseUrl, fullPath),
          thumbPath,
          thumbUrl: publicUrl(publicBaseUrl, thumbPath),
        });
        console.log(`[${gallery.name}] Skip existing: ${file.name}`);
        continue;
      }

      console.log(`[${gallery.name}] Downloading: ${file.name}`);
      const sourceBuffer = await downloadDriveFile(drive, file, gallery.name, driveDownloadSettings);
      const optimized = await optimizeImage(sourceBuffer);

      if (force || !fullExists) {
        await uploadObject({
          s3,
          bucket,
          key: fullPath,
          body: optimized.fullBuffer,
          contentType: 'image/webp',
          cacheControl: 'public, max-age=31536000, immutable',
        });
        stats.uploaded += 1;
        console.log(`[${gallery.name}] Uploaded full: ${fullPath}`);
      } else {
        stats.skipped += 1;
        console.log(`[${gallery.name}] Full exists, upload skipped: ${fullPath}`);
      }

      if (force || !thumbExists) {
        await uploadObject({
          s3,
          bucket,
          key: thumbPath,
          body: optimized.thumbBuffer,
          contentType: 'image/webp',
          cacheControl: 'public, max-age=31536000, immutable',
        });
        stats.uploaded += 1;
        console.log(`[${gallery.name}] Uploaded thumb: ${thumbPath}`);
      } else {
        stats.skipped += 1;
        console.log(`[${gallery.name}] Thumb exists, upload skipped: ${thumbPath}`);
      }

      photos.push({
        sourceFileId: file.id,
        originalName: file.name,
        originalMimeType: file.mimeType,
        originalSize: file.size,
        fullPath,
        fullUrl: publicUrl(publicBaseUrl, fullPath),
        fullSize: optimized.fullBuffer.byteLength,
        width: optimized.fullWidth,
        height: optimized.fullHeight,
        thumbPath,
        thumbUrl: publicUrl(publicBaseUrl, thumbPath),
        thumbSize: optimized.thumbBuffer.byteLength,
        thumbWidth: optimized.thumbWidth,
        thumbHeight: optimized.thumbHeight,
        contentType: 'image/webp',
      });
    } catch (error) {
      stats.errors += 1;
      console.error(`[${gallery.name}] Error processing ${file.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const manifest: GalleryManifest = {
    version: 1,
    name: gallery.name,
    driveFolderId: gallery.driveFolderId,
    prefix: gallery.prefix,
    year: gallery.year ?? null,
    baseTitle: gallery.baseTitle ?? null,
    slug: gallery.slug ?? null,
    generatedAt: new Date().toISOString(),
    photos,
  };

  if (existingManifest && !force && manifestComparable(existingManifest) === manifestComparable(manifest)) {
    console.log(`[${gallery.name}] Manifest unchanged, upload skipped: ${manifestKey}`);
  } else {
    await uploadObject({
      s3,
      bucket,
      key: manifestKey,
      body: `${JSON.stringify(manifest, null, 2)}\n`,
      contentType: 'application/json; charset=utf-8',
      cacheControl: 'public, max-age=60, stale-while-revalidate=300',
    });
    console.log(`[${gallery.name}] Manifest uploaded: ${manifestKey} (${photos.length} photo(s)).`);
  }

  return { stats, manifest, manifestKey };
}

function toIndexPhoto(photo: GalleryManifestPhoto): GalleryIndexPhoto {
  return {
    sourceFileId: photo.sourceFileId,
    originalName: photo.originalName,
    fullPath: photo.fullPath,
    fullUrl: photo.fullUrl,
    width: photo.width,
    height: photo.height,
    thumbPath: photo.thumbPath,
    thumbUrl: photo.thumbUrl,
    thumbWidth: photo.thumbWidth,
    thumbHeight: photo.thumbHeight,
  };
}

function toIndexAlbum(manifest: GalleryManifest, manifestKey: string): GalleryIndexAlbum {
  const previewPhotos = manifest.photos.slice(0, 4).map(toIndexPhoto);
  const slug =
    manifest.slug ??
    (manifest.year ? `${slugifyBaseName(manifest.year, 'year')}-${slugifyBaseName(manifest.name, manifest.driveFolderId)}` : slugifyBaseName(manifest.name, manifest.driveFolderId));

  return {
    id: manifest.driveFolderId,
    title: manifest.name,
    year: manifest.year,
    slug,
    folderId: manifest.driveFolderId,
    driveFolderId: manifest.driveFolderId,
    prefix: manifest.prefix,
    manifestPath: manifestKey,
    baseTitle: manifest.baseTitle,
    photoCount: manifest.photos.length,
    coverPhoto: previewPhotos[0] ?? null,
    previewPhotos,
  };
}

function resolveIndexKey(config: SyncConfig): string {
  const explicitIndexPath = process.env.GALLERY_R2_INDEX_PATH?.trim();
  if (explicitIndexPath) {
    return normalizeObjectKey(explicitIndexPath);
  }

  const rootPrefix = config.webGallery?.targetRootPrefix ?? normalizePrefix(process.env.GALLERY_R2_ROOT_PREFIX ?? '');
  return `${rootPrefix}index.json`;
}

async function uploadGalleryIndex(params: {
  s3: S3Client;
  bucket: string;
  indexKey: string;
  index: GalleryIndex;
  force: boolean;
}) {
  const existingBody = await getObjectText(params.s3, params.bucket, params.indexKey);
  if (existingBody && !params.force) {
    try {
      const existingIndex = JSON.parse(existingBody) as GalleryIndex;
      if (galleryIndexComparable(existingIndex) === galleryIndexComparable(params.index)) {
        console.log(`Gallery index unchanged, upload skipped: ${params.indexKey}`);
        return;
      }
    } catch (error) {
      console.warn(`Existing gallery index ${params.indexKey} is not valid JSON and will be replaced: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  await uploadObject({
    s3: params.s3,
    bucket: params.bucket,
    key: params.indexKey,
    body: `${JSON.stringify(params.index, null, 2)}\n`,
    contentType: 'application/json; charset=utf-8',
    cacheControl: 'public, max-age=60, stale-while-revalidate=300',
  });
  console.log(`Gallery index uploaded: ${params.indexKey} (${params.index.albums.length} album(s)).`);
}

async function main() {
  loadEnvFiles();
  const options = parseArgs(process.argv.slice(2));
  const config = loadSyncConfig(options.configPath);
  const bucket = process.env.CLOUDFLARE_R2_BUCKET?.trim() || 'zelena-liga-gallery';
  const publicBaseUrl = requireEnv('CLOUDFLARE_R2_PUBLIC_BASE_URL');
  const indexKey = resolveIndexKey(config);
  const driveDownloadSettings = getDriveDownloadSettings();
  const drive = createDriveClient();
  const s3 = createR2Client();
  const discoveredGalleries = config.webGallery ? await discoverWebGalleryAlbums(drive, config.webGallery) : [];
  const galleries = [...config.galleries, ...discoveredGalleries];

  if (galleries.length === 0) {
    throw new Error('No galleries selected for sync.');
  }

  console.log(`Gallery sync starting. Config: ${options.configPath}, galleries: ${galleries.length}, bucket: ${bucket}, index: ${indexKey}, force: ${options.force ? 'yes' : 'no'}`);
  console.log(
    `Google Drive downloads: delay ${driveDownloadSettings.delayMs}ms, retries ${driveDownloadSettings.retries}, retry delay ${driveDownloadSettings.retryDelayMs}ms.`,
  );

  const totals: SyncStats = { found: 0, uploaded: 0, skipped: 0, unsupported: 0, errors: 0 };
  const indexAlbums: GalleryIndexAlbum[] = [];
  for (const gallery of galleries) {
    try {
      const result = await syncGallery({
        gallery,
        drive,
        s3,
        bucket,
        publicBaseUrl,
        force: options.force,
        driveDownloadSettings,
      });
      const { stats, manifest, manifestKey } = result;
      totals.found += stats.found;
      totals.uploaded += stats.uploaded;
      totals.skipped += stats.skipped;
      totals.unsupported += stats.unsupported;
      totals.errors += stats.errors;
      indexAlbums.push(toIndexAlbum(manifest, manifestKey));
    } catch (error) {
      totals.errors += 1;
      console.error(`[${gallery.name}] Gallery sync failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  indexAlbums.sort((a, b) => {
    const yearA = sortYearLabel(a.year ?? '');
    const yearB = sortYearLabel(b.year ?? '');
    if (yearA !== yearB) {
      return yearB - yearA;
    }
    if ((a.year ?? '') !== (b.year ?? '')) {
      return (b.year ?? '').localeCompare(a.year ?? '', 'cs');
    }
    return a.title.localeCompare(b.title, 'cs');
  });

  if (indexAlbums.length > 0) {
    await uploadGalleryIndex({
      s3,
      bucket,
      indexKey,
      index: {
        version: 1,
        source: 'cloudflare-r2',
        generatedAt: new Date().toISOString(),
        rootPrefix: config.webGallery?.targetRootPrefix ?? normalizePrefix(process.env.GALLERY_R2_ROOT_PREFIX ?? ''),
        publicBaseUrl,
        albums: indexAlbums,
      },
      force: options.force,
    });
  }

  console.log('\nGallery sync finished.');
  console.log(`Found: ${totals.found}`);
  console.log(`Uploaded objects: ${totals.uploaded}`);
  console.log(`Skipped: ${totals.skipped}`);
  console.log(`Unsupported: ${totals.unsupported}`);
  console.log(`Errors: ${totals.errors}`);

  if (totals.errors > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
