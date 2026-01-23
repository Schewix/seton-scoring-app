import { forwardResponse, getSupabaseConfig, logDev } from './_lib/supabaseProxy.js';

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  let supabaseConfig;
  try {
    supabaseConfig = getSupabaseConfig();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Missing Supabase configuration.';
    return res.status(500).json({ error: message });
  }

  const endpoint = `${supabaseConfig.supabaseUrl}/functions/v1/submit-station-record`;
  const authorization = req.headers?.authorization;

  logDev('[api/submit-station-record] request received', { hasAuthorization: Boolean(authorization) });
  logDev('[api/submit-station-record] proxying request', { endpoint });

  let body: string | undefined;
  if (typeof req.body === 'string') {
    body = req.body;
  } else if (req.body !== undefined) {
    body = JSON.stringify(req.body);
  }

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        apikey: supabaseConfig.supabaseAnonKey,
        'Content-Type': 'application/json',
        ...(authorization ? { Authorization: authorization } : {}),
      },
      body,
    });

    return await forwardResponse(res, response);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to reach submit-station-record.';
    return res.status(502).json({ error: message });
  }
}
