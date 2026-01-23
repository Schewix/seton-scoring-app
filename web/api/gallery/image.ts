import { getDriveClient } from '../_lib/googleDrive.js';

const CACHE_TTL_MS = 10 * 60 * 1000;

function applyCacheHeaders(res: any) {
  res.setHeader('Cache-Control', `public, s-maxage=${Math.floor(CACHE_TTL_MS / 1000)}`);
}

export default async function handler(req: any, res: any) {
  applyCacheHeaders(res);
  res.setHeader('Access-Control-Allow-Origin', '*');

  const fileId = typeof req.query.fileId === 'string' ? req.query.fileId : '';
  if (!fileId) {
    res.status(400).json({ error: 'Missing fileId query parameter.' });
    return;
  }

  try {
    const drive = getDriveClient();
    const response = await drive.files.get(
      {
        fileId,
        alt: 'media',
      },
      { responseType: 'stream' },
    );

    const contentType = response.headers['content-type'] ?? 'application/octet-stream';
    res.setHeader('Content-Type', contentType);

    response.data.on('error', () => {
      res.status(500).end();
    });

    response.data.pipe(res);
  } catch (error) {
    res.status(500).json({ error: 'Failed to load image from Google Drive.' });
  }
}
