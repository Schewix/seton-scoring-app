import { fetchPionyrArticles, type PionyrArticle } from './_lib/pionyr.js';
import { getSupabaseAdminClient } from './_lib/supabaseAdmin.js';

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

async function fetchLocalArticles(): Promise<PublicArticle[]> {
  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from('content_articles')
    .select(
      'id,slug,title,excerpt,body,author,cover_image_url,cover_image_alt,status,published_at,created_at',
    )
    .eq('status', 'published')
    .order('published_at', { ascending: false });

  if (error) {
    console.error('[api/content/articles] supabase error', error);
    return [];
  }

  return (data ?? []).map((row: LocalArticleRow) => ({
    source: 'local',
    slug: row.slug,
    title: row.title,
    excerpt: row.excerpt ?? '',
    dateISO: row.published_at ?? row.created_at,
    author: row.author,
    coverImage: row.cover_image_url ? { url: row.cover_image_url, alt: row.cover_image_alt } : null,
    body: row.body,
    bodyFormat: 'text',
  }));
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

export default async function handler(req: any, res: any) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const [pionyr, local] = await Promise.all([fetchPionyrArticles(), fetchLocalArticles()]);
    const combined = [...local, ...pionyr.map(mapPionyr)].sort(sortByDateDesc);
    res.status(200).json({ articles: combined });
  } catch (error) {
    console.error('[api/content/articles] failed to load', error);
    res.status(500).json({ error: 'Failed to load articles.' });
  }
}
