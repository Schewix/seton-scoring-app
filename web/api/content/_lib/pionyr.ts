type RawArticle = Record<string, any>;

export type PionyrArticle = {
  source: 'pionyr';
  slug: string;
  title: string;
  excerpt: string;
  dateISO: string;
  author?: string | null;
  coverImageUrl?: string | null;
  coverImageAlt?: string | null;
  bodyHtml?: string | null;
};

type PionyrListResponse = {
  items: RawArticle[];
  pageCount: number | null;
};

function normalizeBaseUrl(value: string) {
  return value.endsWith('/') ? value : `${value}/`;
}

function normalizeText(value: string) {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripHtml(value: string) {
  return value.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}

function getString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function pickString(raw: RawArticle, keys: string[]): string | null {
  for (const key of keys) {
    const value = getString(raw[key]);
    if (value) return value;
  }
  return null;
}

function getPageCount(payload: Record<string, any>): number | null {
  const candidates = [
    payload.pageCount,
    payload.page_count,
    payload.pages,
    payload.pagecount,
    payload.totalPages,
  ];
  for (const value of candidates) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
  }
  return null;
}

function getItems(payload: Record<string, any>): RawArticle[] {
  const candidates = [payload.data, payload.items, payload.results];
  for (const value of candidates) {
    if (Array.isArray(value)) {
      return value as RawArticle[];
    }
  }
  return [];
}

function parseListResponse(payload: Record<string, any>): PionyrListResponse {
  return {
    items: getItems(payload),
    pageCount: getPageCount(payload),
  };
}

function getCoverImage(raw: RawArticle): { url?: string | null; alt?: string | null } {
  const url =
    pickString(raw, ['perexPhotoUrl', 'perex_photo_url', 'perexPhoto', 'perex_photo']) ??
    pickString(raw, ['textPhotoUrl', 'text_photo_url', 'textPhoto', 'text_photo']) ??
    pickString(raw, ['photoUrl', 'photo_url']);
  if (url) {
    return { url, alt: null };
  }
  const photos = Array.isArray(raw.photos) ? raw.photos : [];
  if (photos.length > 0) {
    const first = photos[0] as RawArticle;
    return {
      url: pickString(first, ['url', 'src', 'href']),
      alt: pickString(first, ['title', 'alt']),
    };
  }
  return { url: null, alt: null };
}

function parseDate(raw: RawArticle): string | null {
  const value =
    pickString(raw, ['datePublished', 'date_published', 'publishedAt', 'published_at', 'date']) ??
    null;
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function mapArticle(raw: RawArticle): PionyrArticle | null {
  const title = pickString(raw, ['title', 'name']);
  const slug = pickString(raw, ['shortUuid', 'short_uuid', 'shortUUID', 'uuid', 'id']);
  if (!title || !slug) {
    return null;
  }
  const perexRaw = pickString(raw, ['perex', 'excerpt', 'summary']) ?? '';
  const excerpt = stripHtml(perexRaw);
  const author = pickString(raw, ['authorName', 'author', 'author_name']);
  const dateISO = parseDate(raw) ?? new Date().toISOString();
  const cover = getCoverImage(raw);
  const bodyHtml = pickString(raw, ['text', 'body', 'content']);
  return {
    source: 'pionyr',
    slug,
    title,
    excerpt,
    dateISO,
    author,
    coverImageUrl: cover.url ?? null,
    coverImageAlt: cover.alt ?? null,
    bodyHtml: bodyHtml ?? null,
  };
}

function getAuthHeaders() {
  const token = process.env.PIONYR_API_TOKEN ?? '';
  if (!token) {
    throw new Error('Missing PIONYR_API_TOKEN environment variable.');
  }
  return {
    Authorization: `Bearer ${token}`,
    'X-Api-Token': token,
    Accept: 'application/json',
  };
}

function buildUrl(path: string, params?: Record<string, string>) {
  const base = normalizeBaseUrl(process.env.PIONYR_API_BASE_URL ?? 'https://pionyr.cz/api/');
  const url = new URL(path, base);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value) {
        url.searchParams.set(key, value);
      }
    }
  }
  return url;
}

function getFilterTerms(): string[] {
  const raw = process.env.PIONYR_ARTICLE_FILTER ?? '';
  return raw
    .split(/[\n,]/)
    .map((term) => term.trim())
    .filter(Boolean)
    .map(normalizeText);
}

function isAllowed(article: PionyrArticle, terms: string[]): boolean {
  if (terms.length === 0) {
    return true;
  }
  const haystack = normalizeText(`${article.title} ${article.excerpt}`);
  return terms.some((term) => haystack.includes(term));
}

export async function fetchPionyrArticles(): Promise<PionyrArticle[]> {
  const listPath = process.env.PIONYR_API_ARTICLES_PATH ?? 'articles';
  const pageParam = process.env.PIONYR_API_PAGE_PARAM ?? 'page';
  const headers = getAuthHeaders();
  const terms = getFilterTerms();
  const results: PionyrArticle[] = [];

  let page = 1;
  let pageCount: number | null = null;
  let safety = 0;

  do {
    const url = buildUrl(listPath, { [pageParam]: String(page) });
    const response = await fetch(url.toString(), { headers });
    if (!response.ok) {
      throw new Error(`Pionyr API error (${response.status})`);
    }
    const payload = (await response.json()) as Record<string, any>;
    const parsed = parseListResponse(payload);
    pageCount = parsed.pageCount ?? pageCount;
    const items = parsed.items
      .map(mapArticle)
      .filter((item): item is PionyrArticle => Boolean(item))
      .filter((item) => isAllowed(item, terms));
    results.push(...items);
    page += 1;
    safety += 1;
    if (safety > 20) {
      break;
    }
  } while (pageCount && page <= pageCount);

  return results;
}

export async function fetchPionyrArticleBySlug(slug: string): Promise<PionyrArticle | null> {
  const detailPath = process.env.PIONYR_API_ARTICLE_PATH ?? 'article';
  const headers = getAuthHeaders();
  const url = detailPath.includes('{id}')
    ? buildUrl(detailPath.replace('{id}', slug))
    : buildUrl(`${detailPath}/${slug}`);
  const response = await fetch(url.toString(), { headers });
  if (!response.ok) {
    return null;
  }
  const payload = (await response.json()) as Record<string, any>;
  const data = payload.data ?? payload.item ?? payload.article ?? payload;
  const article = mapArticle(data);
  if (!article) {
    return null;
  }
  return article;
}
