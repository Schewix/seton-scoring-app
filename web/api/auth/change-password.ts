import { createClient } from '@supabase/supabase-js';
import { hashPassword } from './password-utils.js';

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export default async function handler(req: any, res: any) {
  const cors = {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
  };

  res.setHeader('Access-Control-Allow-Origin', cors['access-control-allow-origin']);
  res.setHeader('Access-Control-Allow-Methods', cors['access-control-allow-methods']);
  res.setHeader('Access-Control-Allow-Headers', cors['access-control-allow-headers']);

  if (req.method === 'OPTIONS') {
    return res
      .status(200)
      .setHeader('Access-Control-Allow-Origin', cors['access-control-allow-origin'])
      .setHeader('Access-Control-Allow-Methods', cors['access-control-allow-methods'])
      .setHeader('Access-Control-Allow-Headers', cors['access-control-allow-headers'])
      .end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { email, userId, id, newPassword } = req.body ?? {};
  const resolvedEmail = typeof email === 'string' ? email : undefined;
  const resolvedId = typeof userId === 'string' ? userId : typeof id === 'string' ? id : undefined;

  if (typeof newPassword !== 'string' || newPassword.length === 0) {
    return res.status(400).json({ error: 'Missing new password' });
  }

  if (!resolvedEmail && !resolvedId) {
    return res.status(400).json({ error: 'Missing user identifier' });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  let query = supabase.from('judges').select('id, email').limit(1);

  if (resolvedId) {
    query = query.eq('id', resolvedId);
  } else if (resolvedEmail) {
    query = query.eq('email', resolvedEmail);
  }

  const { data: judge, error: fetchError } = await query.maybeSingle();

  if (fetchError) {
    console.error('Failed to load judge for password change', fetchError);
    return res.status(500).json({ error: 'DB error' });
  }

  if (!judge) {
    return res.status(404).json({ error: 'Judge not found' });
  }

  const password_hash = await hashPassword(newPassword);
  const nowIso = new Date().toISOString();

  const { error: updateError } = await supabase
    .from('judges')
    .update({ password_hash, must_change_password: false, password_rotated_at: nowIso })
    .eq('id', judge.id);

  if (updateError) {
    console.error('Failed to update password', updateError);
    return res.status(500).json({ error: 'Failed to change password' });
  }

  return res
    .status(200)
    .setHeader('Access-Control-Allow-Origin', cors['access-control-allow-origin'])
    .json({ success: true });
}
