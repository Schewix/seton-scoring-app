import { google, drive_v3 } from 'googleapis';

type ServiceAccountJson = {
  client_email?: string;
  private_key?: string;
};

function parseServiceAccountJson(raw: string): ServiceAccountJson | null {
  try {
    return JSON.parse(raw) as ServiceAccountJson;
  } catch {
    return null;
  }
}

function decodeBase64(value: string): string | null {
  try {
    return Buffer.from(value, 'base64').toString('utf-8');
  } catch {
    return null;
  }
}

const JSON_BASE64 =
  process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON_BASE64 ??
  process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 ??
  '';
const JSON_RAW =
  process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON ??
  process.env.GOOGLE_SERVICE_ACCOUNT_JSON ??
  '';

let SERVICE_ACCOUNT_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL ?? '';
let PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY ?? '';

if ((!SERVICE_ACCOUNT_EMAIL || !PRIVATE_KEY) && (JSON_BASE64 || JSON_RAW)) {
  const raw = JSON_RAW || decodeBase64(JSON_BASE64 || '') || '';
  const parsed = raw ? parseServiceAccountJson(raw) : null;
  if (parsed?.client_email && !SERVICE_ACCOUNT_EMAIL) {
    SERVICE_ACCOUNT_EMAIL = parsed.client_email;
  }
  if (parsed?.private_key && !PRIVATE_KEY) {
    PRIVATE_KEY = parsed.private_key;
  }
}

if (!SERVICE_ACCOUNT_EMAIL || !PRIVATE_KEY) {
  throw new Error('Missing Google Drive service account credentials.');
}

PRIVATE_KEY = PRIVATE_KEY.replace(/\\n/g, '\n');

let cachedDrive: drive_v3.Drive | null = null;
const SHARED_DRIVE_ID = process.env.GOOGLE_DRIVE_SHARED_DRIVE_ID ?? '';

export function getDriveClient(): drive_v3.Drive {
  if (cachedDrive) {
    return cachedDrive;
  }

  const auth = new google.auth.JWT({
    email: SERVICE_ACCOUNT_EMAIL,
    key: PRIVATE_KEY,
    scopes: ['https://www.googleapis.com/auth/drive.readonly'],
  });

  const driveOptions: drive_v3.Options = { version: 'v3', auth };
  cachedDrive = google.drive(driveOptions);
  return cachedDrive;
}

export function getDriveListOptions(): { corpora?: string; driveId?: string } {
  if (SHARED_DRIVE_ID) {
    return { corpora: 'drive', driveId: SHARED_DRIVE_ID };
  }
  return {};
}

export const DRIVE_FIELDS =
  'nextPageToken, files(id, name, mimeType, thumbnailLink, webContentLink, webViewLink, shortcutDetails)';
