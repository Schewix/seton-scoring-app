import { getSupabaseAdminClient } from '../api-lib/content/supabaseAdmin.js';

type StaticEntry = {
  path: string;
  changefreq?: string;
  priority?: number;
};

type ArticleRow = {
  slug: string | null;
  published_at: string | null;
  created_at: string | null;
};

type SitemapEntry = {
  loc: string;
  lastmod?: string;
  changefreq?: string;
  priority?: number;
};

const BASE_URL = 'https://www.zelenaliga.cz';
const STATIC_ENTRIES: StaticEntry[] = [
  { path: '/', changefreq: 'weekly', priority: 1.0 },
  { path: '/souteze', changefreq: 'weekly', priority: 0.8 },
  { path: '/souteze/setonuv-zavod', changefreq: 'monthly', priority: 0.7 },
  { path: '/souteze/draci-smycka', changefreq: 'monthly', priority: 0.7 },
  { path: '/souteze/kosmuv-prostor', changefreq: 'monthly', priority: 0.7 },
  { path: '/souteze/ringobal', changefreq: 'monthly', priority: 0.7 },
  { path: '/souteze/deskove-hry', changefreq: 'monthly', priority: 0.7 },
  { path: '/souteze/brnenske-bloudeni', changefreq: 'monthly', priority: 0.7 },
  { path: '/souteze/piotrio', changefreq: 'monthly', priority: 0.7 },
  { path: '/souteze/karakoram', changefreq: 'monthly', priority: 0.7 },
  { path: '/souteze/lakros', changefreq: 'monthly', priority: 0.7 },
  { path: '/souteze/vybijena', changefreq: 'monthly', priority: 0.7 },
  { path: '/souteze/memorial-bedricha-stolicky', changefreq: 'monthly', priority: 0.7 },
  { path: '/aplikace', changefreq: 'monthly', priority: 0.6 },
  { path: '/aplikace/setonuv-zavod', changefreq: 'monthly', priority: 0.5 },
  { path: '/aplikace/setonuv-zavod/vysledky', changefreq: 'weekly', priority: 0.5 },
  { path: '/aplikace/deskovky', changefreq: 'weekly', priority: 0.5 },
  { path: '/aplikace/deskovky/standings', changefreq: 'daily', priority: 0.5 },
  { path: '/aplikace/deskovky/pravidla', changefreq: 'monthly', priority: 0.4 },
  { path: '/aktualni-poradi', changefreq: 'weekly', priority: 0.7 },
  { path: '/oddily', changefreq: 'weekly', priority: 0.7 },
  { path: '/fotogalerie', changefreq: 'daily', priority: 0.7 },
  { path: '/clanky', changefreq: 'daily', priority: 0.8 },
  { path: '/o-spto', changefreq: 'monthly', priority: 0.6 },
  { path: '/kontakty', changefreq: 'monthly', priority: 0.6 },
];

function escapeXml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function normalizeDate(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    return null;
  }
  return new Date(timestamp).toISOString();
}

function serializeUrlEntry(entry: SitemapEntry): string {
  const lines = ['  <url>', `    <loc>${escapeXml(entry.loc)}</loc>`];
  if (entry.lastmod) {
    lines.push(`    <lastmod>${escapeXml(entry.lastmod)}</lastmod>`);
  }
  if (entry.changefreq) {
    lines.push(`    <changefreq>${entry.changefreq}</changefreq>`);
  }
  if (typeof entry.priority === 'number') {
    lines.push(`    <priority>${entry.priority.toFixed(1)}</priority>`);
  }
  lines.push('  </url>');
  return lines.join('\n');
}

async function fetchLatestArticleEntries(): Promise<SitemapEntry[]> {
  try {
    const supabase = getSupabaseAdminClient();
    const { data, error } = await supabase
      .from('content_articles')
      .select('slug,published_at,created_at')
      .eq('status', 'published')
      .order('published_at', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false })
      .limit(3);
    if (error) {
      console.error('[api/sitemap] failed to load latest articles', error);
      return [];
    }
    const entries: SitemapEntry[] = [];
    for (const row of data ?? []) {
      const articleRow = row as ArticleRow;
      const slug = typeof articleRow.slug === 'string' ? articleRow.slug.trim() : '';
      if (!slug) {
        continue;
      }
      const lastmod = normalizeDate(articleRow.published_at) ?? normalizeDate(articleRow.created_at);
      entries.push({
        loc: `${BASE_URL}/clanky/${encodeURIComponent(slug)}`,
        ...(lastmod ? { lastmod } : {}),
        changefreq: 'daily',
        priority: 0.7,
      });
    }
    return entries;
  } catch (error) {
    console.error('[api/sitemap] unexpected error while loading latest articles', error);
    return [];
  }
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const staticEntries: SitemapEntry[] = STATIC_ENTRIES.map((entry) => ({
    loc: `${BASE_URL}${entry.path}`,
    changefreq: entry.changefreq,
    priority: entry.priority,
  }));
  const latestArticles = await fetchLatestArticleEntries();
  const entries = [...staticEntries, ...latestArticles];
  const body = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...entries.map((entry) => serializeUrlEntry(entry)),
    '</urlset>',
  ].join('\n');

  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.setHeader('Cache-Control', 'public, s-maxage=900, stale-while-revalidate=300');
  res.status(200).send(body);
}
