import { clearEditorSession } from '../_lib/editorAuth.js';

export default async function handler(req: any, res: any) {
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  clearEditorSession(res);
  res.status(200).json({ ok: true });
}
