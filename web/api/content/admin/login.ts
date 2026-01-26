import { setEditorSession, validatePassword } from '../_lib/editorAuth.js';

export default async function handler(req: any, res: any) {
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  let payload: Record<string, unknown> = {};
  if (typeof req.body === 'string') {
    try {
      payload = JSON.parse(req.body);
    } catch {
      payload = {};
    }
  } else if (req.body && typeof req.body === 'object') {
    payload = req.body;
  }

  const password = typeof payload.password === 'string' ? payload.password : '';
  try {
    if (!validatePassword(password)) {
      res.status(401).json({ error: 'Invalid password' });
      return;
    }
    setEditorSession(res);
    res.status(200).json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to authenticate' });
  }
}
