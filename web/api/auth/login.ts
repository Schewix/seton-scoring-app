import { forwardResponse, getSupabaseConfig, logDev } from '../_lib/supabaseProxy.js';

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { email, password } = req.body ?? {};

  if (typeof email !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ error: 'Missing email or password.' });
  }

  let supabaseConfig;
  try {
    supabaseConfig = getSupabaseConfig();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Missing Supabase configuration.';
    return res.status(500).json({ error: message });
  }

  const endpoint = `${supabaseConfig.supabaseUrl}/auth/v1/token?grant_type=password`;

  logDev('[api/auth/login] proxying request', { endpoint });

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        apikey: supabaseConfig.supabaseAnonKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email, password }),
    });

    return await forwardResponse(res, response);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to reach Supabase auth.';
    return res.status(502).json({ error: message });
  }
}
