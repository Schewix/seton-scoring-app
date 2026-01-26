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

let cachedListPath: string | null = null;
let cachedDetailPath: string | null = null;

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
  const normalizedPath = path.replace(/^\/+/, '');
  const url = new URL(normalizedPath, base);
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

function normalizePath(value: string): string {
  return value.replace(/^\/+/, '').replace(/\/+$/, '');
}

function uniq(paths: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const path of paths) {
    const normalized = normalizePath(path);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function buildListPathCandidates(): string[] {
  const base = normalizePath(process.env.PIONYR_API_ARTICLES_PATH ?? 'articles');
  const alternates = [base];

  if (base.includes('articles')) {
    alternates.push(base.replace('articles', 'clanky'));
  } else if (base.includes('clanky')) {
    alternates.push(base.replace('clanky', 'articles'));
  } else {
    alternates.push('articles', 'clanky');
  }

  const prefixed = alternates
    .filter((path) => !path.startsWith('v1/'))
    .map((path) => `v1/${path}`);

  return uniq([...alternates, ...prefixed]);
}

function buildDetailPathCandidates(): string[] {
  const base = normalizePath(process.env.PIONYR_API_ARTICLE_PATH ?? 'article');
  const alternates = [base];

  if (base.includes('article')) {
    alternates.push(base.replace('article', 'clanek'));
  } else if (base.includes('clanek')) {
    alternates.push(base.replace('clanek', 'article'));
  } else {
    alternates.push('article', 'clanek', 'articles', 'clanky');
  }

  const prefixed = alternates
    .filter((path) => !path.startsWith('v1/'))
    .map((path) => `v1/${path}`);

  return uniq([...alternates, ...prefixed]);
}

async function fetchListPage(
  pathCandidates: string[],
  params: Record<string, string>,
  headers: Record<string, string>,
): Promise<{ payload: Record<string, any>; resolvedPath: string }> {
  for (const candidate of pathCandidates) {
    const url = buildUrl(candidate, params);
    const response = await fetch(url.toString(), { headers });
    if (response.ok) {
      const payload = (await response.json()) as Record<string, any>;
      return { payload, resolvedPath: candidate };
    }
    if (response.status !== 404) {
      throw new Error(`Pionyr API error (${response.status})`);
    }
  }
  throw new Error('Pionyr API error (404)');
}

async function fetchDetail(
  pathCandidates: string[],
  slug: string,
  headers: Record<string, string>,
): Promise<{ payload: Record<string, any> | null; resolvedPath: string | null }> {
  for (const candidate of pathCandidates) {
    const path = candidate.includes('{id}') ? candidate.replace('{id}', slug) : `${candidate}/${slug}`;
    const url = buildUrl(path);
    const response = await fetch(url.toString(), { headers });
    if (response.ok) {
      const payload = (await response.json()) as Record<string, any>;
      return { payload, resolvedPath: candidate };
    }
    if (response.status !== 404) {
      throw new Error(`Pionyr API error (${response.status})`);
    }
  }
  return { payload: null, resolvedPath: null };
}

function isAllowed(article: PionyrArticle, terms: string[]): boolean {
  if (terms.length === 0) {
    return true;
  }
  const haystack = normalizeText(`${article.title} ${article.excerpt}`);
  return terms.some((term) => haystack.includes(term));
}

export async function fetchPionyrArticles(): Promise<PionyrArticle[]> {
  const pageParam = process.env.PIONYR_API_PAGE_PARAM ?? 'page';
  const headers = getAuthHeaders();
  const terms = getFilterTerms();
  const results: PionyrArticle[] = [];

  let page = 1;
  let pageCount: number | null = null;
  let safety = 0;
  const candidates = cachedListPath ? [cachedListPath] : buildListPathCandidates();

  do {
    const { payload, resolvedPath } = await fetchListPage(candidates, { [pageParam]: String(page) }, headers);
    cachedListPath = resolvedPath;
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
  const headers = getAuthHeaders();
  const candidates = cachedDetailPath ? [cachedDetailPath] : buildDetailPathCandidates();
  const { payload, resolvedPath } = await fetchDetail(candidates, slug, headers);
  if (!payload) {
    return null;
  }
  cachedDetailPath = resolvedPath ?? cachedDetailPath;
  const data = payload.data ?? payload.item ?? payload.article ?? payload;
  const article = mapArticle(data);
  if (!article) {
    return null;
  }
  return article;
}
