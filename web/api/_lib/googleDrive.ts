import { google, drive_v3 } from 'googleapis';

const REQUIRED_ENV = ['GOOGLE_SERVICE_ACCOUNT_EMAIL', 'GOOGLE_PRIVATE_KEY'];

for (const name of REQUIRED_ENV) {
  if (!process.env[name]) {
    throw new Error(`Missing environment variable ${name} for Google Drive API`);
  }
}

const SERVICE_ACCOUNT_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL!;
const PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY!.replace(/\\n/g, '\n');

let cachedDrive: drive_v3.Drive | null = null;

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

export const DRIVE_FIELDS =
  'nextPageToken, files(id, name, mimeType, thumbnailLink, webContentLink, webViewLink, shortcutDetails)';
