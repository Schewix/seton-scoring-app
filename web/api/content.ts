import {
  fetchPionyrArticleBySlug,
  fetchPionyrArticles,
  type PionyrArticle,
} from '../api-lib/content/pionyr.js';
import {
  clearEditorSession,
  requireEditor,
  setEditorSession,
  validatePassword,
  verifyEditorSession,
} from '../api-lib/content/editorAuth.js';
import { getSupabaseAdminClient } from '../api-lib/content/supabaseAdmin.js';

type LocalArticleRow = {
  id: string;
  slug: string;
  title: string;
  excerpt: string | null;
  body: string | null;
  author: string | null;
  cover_image_url: string | null;
  cover_image_alt: string | null;
  status: string;
  published_at: string | null;
  created_at: string;
  source?: string | null;
  external_id?: string | null;
  external_url?: string | null;
  synced_at?: string | null;
};

type LeagueScoreRow = {
  troop_id: string;
  event_key: string;
  points: number | null;
};

type PublicArticle = {
  source: 'pionyr' | 'local';
  slug: string;
  title: string;
  excerpt: string;
  dateISO: string;
  author?: string | null;
  coverImage?: { url: string | null; alt?: string | null } | null;
  body?: string | null;
  bodyFormat?: 'html' | 'text' | null;
};

type LeagueScoreInput = {
  troop_id: string;
  event_key: string;
  points: number | null;
};

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

function parseLeagueScores(payload: Record<string, unknown>): LeagueScoreInput[] | null {
  const raw = payload.scores;
  if (!Array.isArray(raw)) {
    return null;
  }
  const parsed: LeagueScoreInput[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }
    const troopId = typeof (entry as any).troop_id === 'string' ? (entry as any).troop_id.trim() : '';
    const eventKey = typeof (entry as any).event_key === 'string' ? (entry as any).event_key.trim() : '';
    if (!troopId || !eventKey) {
      continue;
    }
    const pointsRaw = (entry as any).points;
    let points: number | null = null;
    if (pointsRaw === null || pointsRaw === undefined || pointsRaw === '') {
      points = null;
    } else if (typeof pointsRaw === 'number') {
      points = Number.isFinite(pointsRaw) ? pointsRaw : null;
    } else if (typeof pointsRaw === 'string') {
      const normalized = pointsRaw.replace(',', '.').trim();
      const parsedNumber = Number(normalized);
      points = Number.isFinite(parsedNumber) ? parsedNumber : null;
    } else {
      continue;
    }
    parsed.push({ troop_id: troopId, event_key: eventKey, points });
  }
  return parsed.length > 0 ? parsed : null;
}

function mapPionyr(article: PionyrArticle): PublicArticle {
  return {
    source: 'pionyr',
    slug: article.slug,
    title: article.title,
    excerpt: article.excerpt,
    dateISO: article.dateISO,
    author: article.author ?? null,
    coverImage: article.coverImageUrl ? { url: article.coverImageUrl, alt: article.coverImageAlt } : null,
    body: article.bodyHtml ?? null,
    bodyFormat: 'html',
  };
}

function sortByDateDesc(a: PublicArticle, b: PublicArticle) {
  const dateA = new Date(a.dateISO).getTime();
  const dateB = new Date(b.dateISO).getTime();
  if (Number.isNaN(dateA) || Number.isNaN(dateB)) {
    return 0;
  }
  return dateB - dateA;
}

function mapLocalRow(row: LocalArticleRow): PublicArticle {
  const source = row.source === 'pionyr' ? 'pionyr' : 'local';
  return {
    source,
    slug: row.slug,
    title: row.title,
    excerpt: row.excerpt ?? '',
    dateISO: row.published_at ?? row.created_at,
    author: row.author,
    coverImage: row.cover_image_url ? { url: row.cover_image_url, alt: row.cover_image_alt } : null,
    body: row.body,
    bodyFormat: source === 'pionyr' ? 'html' : 'text',
  };
}

async function fetchLocalArticles(): Promise<PublicArticle[]> {
  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from('content_articles')
    .select(
      'id,slug,title,excerpt,body,author,cover_image_url,cover_image_alt,status,published_at,created_at,source,external_id,external_url,synced_at',
    )
    .eq('status', 'published')
    .order('published_at', { ascending: false });

  if (error) {
    console.error('[api/content] supabase error', error);
    return [];
  }

  return (data ?? []).map((row: LocalArticleRow) => mapLocalRow(row));
}

async function handlePublicList(req: any, res: any) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=600');
  try {
    const local = await fetchLocalArticles();
    res.status(200).json({ articles: local.sort(sortByDateDesc) });
  } catch (error) {
    console.error('[api/content/articles] failed', error);
    res.status(500).json({ error: 'Failed to load articles.' });
  }
}

async function handlePublicDetail(req: any, res: any, slug: string) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=600');
  try {
    const supabase = getSupabaseAdminClient();
    const { data, error } = await supabase
      .from('content_articles')
      .select(
        'id,slug,title,excerpt,body,author,cover_image_url,cover_image_alt,status,published_at,created_at,source',
      )
      .eq('slug', slug)
      .eq('status', 'published')
      .maybeSingle();

    if (!error && data) {
      const row = data as LocalArticleRow;
      const source = row.source === 'pionyr' ? 'pionyr' : 'local';
      res.status(200).json({
        article: {
          source,
          slug: row.slug,
          title: row.title,
          excerpt: row.excerpt ?? '',
          dateISO: row.published_at ?? row.created_at,
          author: row.author,
          coverImage: row.cover_image_url ? { url: row.cover_image_url, alt: row.cover_image_alt } : null,
          body: row.body,
          bodyFormat: source === 'pionyr' ? 'html' : 'text',
        },
      });
      return;
    }

    const pionyrArticle = await fetchPionyrArticleBySlug(slug);
    if (!pionyrArticle) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    res.status(200).json({ article: mapPionyr(pionyrArticle) });
  } catch (error) {
    console.error('[api/content/articles/[slug]] failed', error);
    res.status(500).json({ error: 'Failed to load article.' });
  }
}

function isImportAuthorized(req: any, res: any): boolean {
  const secret = process.env.CONTENT_IMPORT_SECRET ?? '';
  const cronSecret = process.env.CRON_SECRET ?? '';
  const authHeader = typeof req.headers?.authorization === 'string' ? req.headers.authorization : '';
  const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  if (cronSecret && bearerToken === cronSecret) {
    return true;
  }
  if (secret) {
    const querySecret = typeof req.query?.secret === 'string' ? req.query.secret : '';
    const headerSecret = typeof req.headers?.['x-import-secret'] === 'string' ? req.headers['x-import-secret'] : '';
    if (querySecret === secret || headerSecret === secret) {
      return true;
    }
  }
  return requireEditor(req, res);
}

async function handleAdminImport(req: any, res: any) {
  if (!isImportAuthorized(req, res)) {
    return;
  }
  if (req.method !== 'POST' && req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const list = await fetchPionyrArticles();
    const enriched = await Promise.all(
      list.map(async (article) => {
        if (article.bodyHtml) {
          return article;
        }
        const detail = await fetchPionyrArticleBySlug(article.slug);
        return detail ?? article;
      }),
    );

    const now = new Date().toISOString();
    const rows = enriched.map((article) => ({
      slug: article.slug,
      title: article.title,
      excerpt: article.excerpt ?? '',
      body: article.bodyHtml ?? null,
      author: article.author ?? null,
      cover_image_url: article.coverImageUrl ?? null,
      cover_image_alt: article.coverImageAlt ?? null,
      status: 'published',
      published_at: article.dateISO ?? now,
      source: 'pionyr',
      external_id: article.slug,
      synced_at: now,
    }));

    const supabase = getSupabaseAdminClient();
    const { error: deleteError } = await supabase
      .from('content_articles')
      .delete()
      .eq('source', 'pionyr');
    if (deleteError) {
      res.status(500).json({ error: 'Failed to clear imported articles.' });
      return;
    }

    if (rows.length > 0) {
      const { error: insertError } = await supabase.from('content_articles').insert(rows);
      if (insertError) {
        res.status(500).json({ error: 'Failed to import articles.' });
        return;
      }
    }

    res.status(200).json({ ok: true, imported: rows.length });
  } catch (error) {
    console.error('[api/content/import] failed', error);
    res.status(500).json({ error: 'Failed to import articles.' });
  }
}

async function handleAdminSession(req: any, res: any) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  const { ok } = verifyEditorSession(req);
  if (!ok) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  res.status(200).json({ ok: true });
}

async function handleAdminLogin(req: any, res: any) {
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  const payload = resolveBody(req);
  const password = typeof payload.password === 'string' ? payload.password : '';
  try {
    if (!validatePassword(password)) {
      res.status(401).json({ error: 'Invalid password' });
      return;
    }
    setEditorSession(res);
    res.status(200).json({ ok: true });
  } catch {
    res.status(500).json({ error: 'Failed to authenticate' });
  }
}

async function handleAdminLogout(req: any, res: any) {
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

async function handleAdminArticles(req: any, res: any) {
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
    const slug =
      typeof payload.slug === 'string' && payload.slug.trim().length > 0 ? payload.slug.trim() : slugify(title);
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

async function handleAdminArticle(req: any, res: any, id: string) {
  if (!requireEditor(req, res)) {
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

async function handlePublicLeague(req: any, res: any) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=600');
  try {
    const supabase = getSupabaseAdminClient();
    const { data, error } = await supabase
      .from('content_league_scores')
      .select('troop_id,event_key,points');
    if (error) {
      res.status(500).json({ error: 'Failed to load league scores.' });
      return;
    }
    res.status(200).json({ scores: (data ?? []) as LeagueScoreRow[] });
  } catch (error) {
    console.error('[api/content/league] failed', error);
    res.status(500).json({ error: 'Failed to load league scores.' });
  }
}

async function handleAdminLeague(req: any, res: any) {
  if (!requireEditor(req, res)) {
    return;
  }
  const supabase = getSupabaseAdminClient();

  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('content_league_scores')
      .select('troop_id,event_key,points');
    if (error) {
      res.status(500).json({ error: 'Failed to load league scores.' });
      return;
    }
    res.status(200).json({ scores: (data ?? []) as LeagueScoreRow[] });
    return;
  }

  if (req.method === 'PUT') {
    const payload = resolveBody(req);
    const scores = parseLeagueScores(payload);
    if (!scores) {
      res.status(400).json({ error: 'Invalid payload.' });
      return;
    }
    const { error } = await supabase
      .from('content_league_scores')
      .upsert(scores, { onConflict: 'troop_id,event_key' });
    if (error) {
      res.status(500).json({ error: 'Failed to save league scores.' });
      return;
    }
    res.status(200).json({ ok: true });
    return;
  }

  res.status(405).json({ error: 'Method not allowed' });
}

export default async function handler(req: any, res: any) {
  const rawPath = req.query?.path;
  let segments = Array.isArray(rawPath)
    ? rawPath
    : typeof rawPath === 'string'
      ? rawPath.split('/').filter(Boolean)
      : [];

  if (segments.length === 0 && typeof req.url === 'string') {
    try {
      const url = new URL(req.url, 'http://localhost');
      const prefix = '/api/content';
      const index = url.pathname.indexOf(prefix);
      if (index >= 0) {
        const rest = url.pathname.slice(index + prefix.length).replace(/^\/+/, '');
        segments = rest.split('/').filter(Boolean);
      }
    } catch {
      // ignore malformed URL and fall back to empty segments
    }
  }

  if (segments.length === 0) {
    res.status(404).json({ error: 'Not found' });
    return;
  }

  if (segments[0] === 'articles') {
    if (segments.length === 1) {
      await handlePublicList(req, res);
      return;
    }
    if (segments.length >= 2) {
      await handlePublicDetail(req, res, segments[1]);
      return;
    }
  }

  if (segments[0] === 'league') {
    await handlePublicLeague(req, res);
    return;
  }

  if (segments[0] === 'admin') {
    const action = segments[1] ?? '';
    if (action === 'session') {
      await handleAdminSession(req, res);
      return;
    }
    if (action === 'login') {
      await handleAdminLogin(req, res);
      return;
    }
    if (action === 'logout') {
      await handleAdminLogout(req, res);
      return;
    }
    if (action === 'articles') {
      if (segments.length === 2) {
        await handleAdminArticles(req, res);
        return;
      }
      if (segments.length >= 3) {
        await handleAdminArticle(req, res, segments[2]);
        return;
      }
    }
    if (action === 'import') {
      await handleAdminImport(req, res);
      return;
    }
    if (action === 'league') {
      await handleAdminLeague(req, res);
      return;
    }
  }

  res.status(404).json({ error: 'Not found' });
}
