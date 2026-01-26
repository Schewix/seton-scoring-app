import { fetchPionyrArticleBySlug } from '../_lib/pionyr.js';
import { getSupabaseAdminClient } from '../_lib/supabaseAdmin.js';

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
};

export default async function handler(req: any, res: any) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const slug = typeof req.query?.slug === 'string' ? req.query.slug : Array.isArray(req.query?.slug) ? req.query.slug[0] : null;
  if (!slug) {
    res.status(400).json({ error: 'Missing slug.' });
    return;
  }

  try {
    const supabase = getSupabaseAdminClient();
    const { data, error } = await supabase
      .from('content_articles')
      .select(
        'id,slug,title,excerpt,body,author,cover_image_url,cover_image_alt,status,published_at,created_at',
      )
      .eq('slug', slug)
      .eq('status', 'published')
      .maybeSingle();

    if (!error && data) {
      const row = data as LocalArticleRow;
      res.status(200).json({
        article: {
          source: 'local',
          slug: row.slug,
          title: row.title,
          excerpt: row.excerpt ?? '',
          dateISO: row.published_at ?? row.created_at,
          author: row.author,
          coverImage: row.cover_image_url ? { url: row.cover_image_url, alt: row.cover_image_alt } : null,
          body: row.body,
          bodyFormat: 'text',
        },
      });
      return;
    }

    const pionyrArticle = await fetchPionyrArticleBySlug(slug);
    if (!pionyrArticle) {
      res.status(404).json({ error: 'Not found' });
      return;
    }

    res.status(200).json({
      article: {
        source: 'pionyr',
        slug: pionyrArticle.slug,
        title: pionyrArticle.title,
        excerpt: pionyrArticle.excerpt,
        dateISO: pionyrArticle.dateISO,
        author: pionyrArticle.author ?? null,
        coverImage: pionyrArticle.coverImageUrl
          ? { url: pionyrArticle.coverImageUrl, alt: pionyrArticle.coverImageAlt }
          : null,
        body: pionyrArticle.bodyHtml ?? null,
        bodyFormat: 'html',
      },
    });
  } catch (error) {
    console.error('[api/content/articles/[slug]] failed', error);
    res.status(500).json({ error: 'Failed to load article.' });
  }
}
