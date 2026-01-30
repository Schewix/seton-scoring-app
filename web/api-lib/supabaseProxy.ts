const DEFAULT_SUPABASE_URL = 'https://vdkbdnxkpeeqxnruwiah.supabase.co';

export function getSupabaseConfig() {
  const supabaseUrl = (process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? DEFAULT_SUPABASE_URL)
    .replace(/\/$/, '');
  const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY;

  if (!supabaseAnonKey) {
    throw new Error('Missing VITE_SUPABASE_ANON_KEY environment variable.');
  }

  return { supabaseUrl, supabaseAnonKey };
}

export function logDev(message: string, details: Record<string, unknown>) {
  if (process.env.NODE_ENV === 'production') {
    return;
  }
  console.debug(message, details);
}

export async function forwardResponse(res: any, response: Response) {
  res.status(response.status);
  const contentType = response.headers.get('content-type');
  if (contentType) {
    res.setHeader('Content-Type', contentType);
  }
  const body = await response.text();
  res.send(body);
}
