// web/api/auth/login.ts
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

function b64(s: string) { return new Uint8Array(Buffer.from(s, 'base64')); }
async function verifyPbkdf2(password: string, stored: string) {
  const [scheme, algo, iterStr, b64Salt, b64Hash] = stored.split('$');
  if (scheme !== 'pbkdf2' || algo !== 'sha256') return false;
  const iterations = Number(iterStr);
  const salt = b64(b64Salt);
  const expected = b64(b64Hash);
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), { name: 'PBKDF2' }, false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, expected.byteLength * 8);
  const got = new Uint8Array(bits);
  if (got.length !== expected.length) return false;
  let diff = 0; for (let i = 0; i < got.length; i++) diff |= got[i] ^ expected[i];
  return diff === 0;
}

export default async function handler(req: any, res: any) {
  const cors = {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
  };
  if (req.method === 'OPTIONS') {
    return res.status(200)
      .setHeader('Access-Control-Allow-Origin', cors['access-control-allow-origin'])
      .setHeader('Access-Control-Allow-Methods', cors['access-control-allow-methods'])
      .setHeader('Access-Control-Allow-Headers', cors['access-control-allow-headers'])
      .end();
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const { email, password } = req.body ?? {};
  if (!email || !password) return res.status(400).json({ error: 'Missing credentials' });

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const { data, error } = await supabase
    .from('judges')
    .select('id,email,password_hash,must_change_password')
    .eq('email', email)
    .limit(1);
  if (error) return res.status(500).json({ error: 'DB error' });

  const row = Array.isArray(data) && data[0];
  if (!row) return res.status(401).json({ error: 'Invalid credentials' });

  const ok = await verifyPbkdf2(password, row.password_hash);
  if (!ok) return res.status(401).json({ error: 'Invalid credentials' });

  // TODO: vytvoř a vrať vlastní session/JWT
  return res.status(200)
    .setHeader('Content-Type', 'application/json')
    .json({ id: row.id, must_change_password: row.must_change_password });
}