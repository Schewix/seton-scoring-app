import { requireEditor } from '../_lib/editorAuth.js';
import { getSupabaseAdminClient } from '../_lib/supabaseAdmin.js';

function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function resolveBody(req: any): Record<string, unknown> {
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  if (req.body && typeof req.body === 'object') {
    return req.body as Record<string, unknown>;
  }
  return {};
}

export default async function handler(req: any, res: any) {
  if (!requireEditor(req, res)) {
    return;
  }

  const supabase = getSupabaseAdminClient();

  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('content_articles')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      res.status(500).json({ error: 'Failed to load articles.' });
      return;
    }

    res.status(200).json({ articles: data ?? [] });
    return;
  }

  if (req.method === 'POST') {
    const payload = resolveBody(req);
    const title = typeof payload.title === 'string' ? payload.title.trim() : '';
    if (!title) {
      res.status(400).json({ error: 'Missing title.' });
      return;
    }
    const status =
      typeof payload.status === 'string' && ['draft', 'published'].includes(payload.status)
        ? payload.status
        : 'draft';
    const slug = typeof payload.slug === 'string' && payload.slug.trim().length > 0 ? payload.slug.trim() : slugify(title);
    const now = new Date().toISOString();
    const publishedAt = status === 'published' ? (payload.published_at as string | undefined) ?? now : null;

    const { data, error } = await supabase
      .from('content_articles')
      .insert({
        slug,
        title,
        excerpt: typeof payload.excerpt === 'string' ? payload.excerpt : null,
        body: typeof payload.body === 'string' ? payload.body : null,
        author: typeof payload.author === 'string' ? payload.author : null,
        cover_image_url: typeof payload.cover_image_url === 'string' ? payload.cover_image_url : null,
        cover_image_alt: typeof payload.cover_image_alt === 'string' ? payload.cover_image_alt : null,
        status,
        published_at: publishedAt,
      })
      .select('*')
      .single();

    if (error) {
      res.status(500).json({ error: 'Failed to create article.' });
      return;
    }

    res.status(200).json({ article: data });
    return;
  }

  res.status(405).json({ error: 'Method not allowed' });
}
