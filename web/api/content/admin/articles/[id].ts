import { requireEditor } from '../../_lib/editorAuth.js';
import { getSupabaseAdminClient } from '../../_lib/supabaseAdmin.js';

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

  const id = typeof req.query?.id === 'string' ? req.query.id : Array.isArray(req.query?.id) ? req.query.id[0] : null;
  if (!id) {
    res.status(400).json({ error: 'Missing article id.' });
    return;
  }

  const supabase = getSupabaseAdminClient();

  if (req.method === 'PUT') {
    const payload = resolveBody(req);
    const status =
      typeof payload.status === 'string' && ['draft', 'published'].includes(payload.status)
        ? payload.status
        : undefined;
    const publishedAt =
      status === 'published'
        ? (typeof payload.published_at === 'string' ? payload.published_at : new Date().toISOString())
        : status === 'draft'
          ? null
          : undefined;

    const update: Record<string, unknown> = {};
    if (typeof payload.slug === 'string') update.slug = payload.slug.trim();
    if (typeof payload.title === 'string') update.title = payload.title.trim();
    if (typeof payload.excerpt === 'string') update.excerpt = payload.excerpt;
    if (typeof payload.body === 'string') update.body = payload.body;
    if (typeof payload.author === 'string') update.author = payload.author;
    if (typeof payload.cover_image_url === 'string') update.cover_image_url = payload.cover_image_url;
    if (typeof payload.cover_image_alt === 'string') update.cover_image_alt = payload.cover_image_alt;
    if (status) update.status = status;
    if (publishedAt !== undefined) update.published_at = publishedAt;

    const { data, error } = await supabase
      .from('content_articles')
      .update(update)
      .eq('id', id)
      .select('*')
      .single();

    if (error) {
      res.status(500).json({ error: 'Failed to update article.' });
      return;
    }

    res.status(200).json({ article: data });
    return;
  }

  if (req.method === 'DELETE') {
    const { error } = await supabase.from('content_articles').delete().eq('id', id);
    if (error) {
      res.status(500).json({ error: 'Failed to delete article.' });
      return;
    }
    res.status(200).json({ ok: true });
    return;
  }

  res.status(405).json({ error: 'Method not allowed' });
}
