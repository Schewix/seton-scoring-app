import { JSDOM } from 'jsdom';

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
let cachedWebList: { items: WebArticleListItem[]; fetchedAt: number } | null = null;

type WebArticleListItem = {
  slug: string;
  title: string;
  excerpt: string;
  dateISO: string;
  coverImageUrl?: string | null;
  coverImageAlt?: string | null;
  detailUrl: string;
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

function parseCzechDate(value: string): string | null {
  const match = value.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if (!match) return null;
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  if (!day || !month || !year) return null;
  const date = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
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

function resolveBaseForPath(base: string, path: string) {
  if (/^https?:\/\//i.test(path)) {
    return undefined;
  }
  if (/^\/?API\.php/i.test(path)) {
    return base.replace(/\/api\/?$/i, '/');
  }
  return base;
}

function buildUrl(path: string, params?: Record<string, string>) {
  const base = normalizeBaseUrl(process.env.PIONYR_API_BASE_URL ?? 'https://pionyr.cz/api/');
  if (/^https?:\/\//i.test(path)) {
    const url = new URL(path);
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value) {
          url.searchParams.set(key, value);
        }
      }
    }
    return url;
  }
  const normalizedPath = path.replace(/^\/+/, '');
  const resolvedBase = resolveBaseForPath(base, normalizedPath);
  const url = new URL(normalizedPath, resolvedBase);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value) {
        url.searchParams.set(key, value);
      }
    }
  }
  return url;
}

function getWebBaseUrl() {
  return normalizeBaseUrl(process.env.PIONYR_WEB_BASE_URL ?? 'https://jihomoravsky.pionyr.cz');
}

function buildWebUrl(path: string) {
  const base = getWebBaseUrl();
  if (/^https?:\/\//i.test(path)) {
    return new URL(path);
  }
  const normalizedPath = path.replace(/^\/+/, '');
  return new URL(normalizedPath, base);
}

function absolutizeUrl(value: string | null, base: string): string | null {
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return value;
  try {
    return new URL(value, base).toString();
  } catch {
    return value;
  }
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

  const phpCandidates = ['API.php?action=content', 'API.php?action=web'];

  return uniq([...alternates, ...prefixed, ...phpCandidates]);
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

  const phpCandidates = [
    'API.php?action=content&id={id}',
    'API.php?action=content&uuid={id}',
    'API.php?action=content&slug={id}',
    'API.php?action=web&id={id}',
    'API.php?action=web&uuid={id}',
    'API.php?action=web&slug={id}',
  ];

  return uniq([...alternates, ...prefixed, ...phpCandidates]);
}

function splitDateAndTitle(value: string | null): { dateISO: string | null; title: string | null } {
  if (!value) return { dateISO: null, title: null };
  const parts = value.split('|').map((part) => part.trim());
  if (parts.length >= 2) {
    return {
      dateISO: parseCzechDate(parts[0]) ?? null,
      title: parts.slice(1).join(' | ').trim() || null,
    };
  }
  return { dateISO: parseCzechDate(value) ?? null, title: value.trim() || null };
}

function normalizeDocumentUrls(doc: Document, base: string) {
  doc.querySelectorAll('img').forEach((img) => {
    const src = img.getAttribute('src');
    const resolved = absolutizeUrl(src, base);
    if (resolved) img.setAttribute('src', resolved);
  });
  doc.querySelectorAll('a').forEach((link) => {
    const href = link.getAttribute('href');
    const resolved = absolutizeUrl(href, base);
    if (resolved) link.setAttribute('href', resolved);
  });
}

async function fetchWebListItems(): Promise<WebArticleListItem[]> {
  const ttlMs = Number(process.env.PIONYR_WEB_LIST_TTL_MS ?? '3600000');
  const now = Date.now();
  if (cachedWebList && now - cachedWebList.fetchedAt < ttlMs) {
    return cachedWebList.items;
  }

  const listPath = process.env.PIONYR_WEB_ARTICLES_PATH ?? 'clanky';
  const listUrl = buildWebUrl(listPath);
  const response = await fetch(listUrl.toString());
  if (!response.ok) {
    throw new Error(`Pionyr web error (${response.status})`);
  }
  const html = await response.text();
  const dom = new JSDOM(html);
  const doc = dom.window.document;
  normalizeDocumentUrls(doc, listUrl.toString());

  const items: WebArticleListItem[] = [];
  doc.querySelectorAll('.reference-item').forEach((item) => {
    const link = item.querySelector('a');
    const href = link?.getAttribute('href');
    if (!href) return;
    const detailUrl = buildWebUrl(href).toString();
    const headingText = item.querySelector('h5')?.textContent ?? null;
    const { dateISO, title } = splitDateAndTitle(headingText);
    const perexNode = item.querySelector('p');
    const excerpt = perexNode ? stripHtml(perexNode.innerHTML ?? perexNode.textContent ?? '') : '';
    const image = item.querySelector('img');
    const coverImageUrl = image?.getAttribute('src') ?? null;
    const coverImageAlt = image?.getAttribute('alt') ?? null;

    const detail = new URL(detailUrl);
    const slug = detail.pathname.split('/').filter(Boolean)[1] ?? detail.pathname.split('/').filter(Boolean).pop();
    if (!slug || !title) return;
    items.push({
      slug,
      title,
      excerpt,
      dateISO: dateISO ?? new Date().toISOString(),
      coverImageUrl,
      coverImageAlt,
      detailUrl,
    });
  });

  cachedWebList = { items, fetchedAt: now };
  return items;
}

async function fetchWebDetailBySlug(slug: string): Promise<PionyrArticle | null> {
  const baseUrl = getWebBaseUrl();
  const list = await fetchWebListItems();
  const listItem = list.find((item) => item.slug === slug);
  const detailUrl = listItem?.detailUrl ?? buildWebUrl(`clanky/${slug}`).toString();
  const response = await fetch(detailUrl);
  if (!response.ok) {
    return listItem
      ? {
          source: 'pionyr',
          slug: listItem.slug,
          title: listItem.title,
          excerpt: listItem.excerpt,
          dateISO: listItem.dateISO,
          coverImageUrl: listItem.coverImageUrl ?? null,
          coverImageAlt: listItem.coverImageAlt ?? null,
          bodyHtml: null,
        }
      : null;
  }
  const html = await response.text();
  const dom = new JSDOM(html);
  const doc = dom.window.document;
  normalizeDocumentUrls(doc, baseUrl);

  const headingText = doc.querySelector('h3')?.textContent ?? listItem?.title ?? null;
  const { dateISO, title } = splitDateAndTitle(headingText);
  const perexNode = doc.querySelector('h3 + p');
  const excerpt = perexNode ? stripHtml(perexNode.innerHTML ?? perexNode.textContent ?? '') : listItem?.excerpt ?? '';

  const imageNodes = Array.from(doc.querySelectorAll('.column-reference-img img'));
  const imageUrls = imageNodes.map((img) => img.getAttribute('src')).filter(Boolean) as string[];
  const imageAlts = imageNodes.map((img) => img.getAttribute('alt'));

  const bodyNodes: string[] = [];
  let node = perexNode ? perexNode.nextElementSibling : null;
  while (node) {
    if (node.classList.contains('more-info')) break;
    bodyNodes.push(node.outerHTML);
    node = node.nextElementSibling;
  }
  const bodyContent = bodyNodes.join('').trim();
  const galleryHtml = imageUrls
    .slice(1)
    .map((url, index) => {
      const alt = imageAlts[index + 1] ?? '';
      return `<figure class="homepage-article-photo"><img src="${url}" alt="${alt ?? ''}" loading="lazy" /></figure>`;
    })
    .join('');

  return {
    source: 'pionyr',
    slug: listItem?.slug ?? slug,
    title: title ?? listItem?.title ?? slug,
    excerpt,
    dateISO: dateISO ?? listItem?.dateISO ?? new Date().toISOString(),
    author: null,
    coverImageUrl: imageUrls[0] ?? listItem?.coverImageUrl ?? null,
    coverImageAlt: imageAlts[0] ?? listItem?.coverImageAlt ?? null,
    bodyHtml: `${galleryHtml}${bodyContent}` || null,
  };
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

function shouldUseWebOnly() {
  return process.env.PIONYR_WEB_ONLY === 'true';
}

async function fetchPionyrArticlesFromWeb(terms: string[]): Promise<PionyrArticle[]> {
  const items = await fetchWebListItems();
  return items
    .map((item) => ({
      source: 'pionyr' as const,
      slug: item.slug,
      title: item.title,
      excerpt: item.excerpt,
      dateISO: item.dateISO,
      author: null,
      coverImageUrl: item.coverImageUrl ?? null,
      coverImageAlt: item.coverImageAlt ?? null,
      bodyHtml: null,
    }))
    .filter((item) => isAllowed(item, terms));
}

export async function fetchPionyrArticles(filterOverride?: string[] | null): Promise<PionyrArticle[]> {
  const pageParam = process.env.PIONYR_API_PAGE_PARAM ?? 'page';
  const terms = filterOverride ?? getFilterTerms();
  const results: PionyrArticle[] = [];

  if (shouldUseWebOnly()) {
    return fetchPionyrArticlesFromWeb(terms);
  }

  let headers: Record<string, string>;
  try {
    headers = getAuthHeaders();
  } catch (error) {
    console.warn('[pionyr] API token missing, falling back to web scraping.', error);
    return fetchPionyrArticlesFromWeb(terms);
  }

  let page = 1;
  let pageCount: number | null = null;
  let safety = 0;
  const candidates = cachedListPath ? [cachedListPath] : buildListPathCandidates();

  do {
    try {
      const { payload, resolvedPath } = await fetchListPage(
        candidates,
        { [pageParam]: String(page) },
        headers,
      );
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
    } catch (error) {
      console.warn('[pionyr] API failed, falling back to web scraping.', error);
      return fetchPionyrArticlesFromWeb(terms);
    }
  } while (pageCount && page <= pageCount);

  return results;
}

export async function fetchPionyrArticleBySlug(slug: string): Promise<PionyrArticle | null> {
  if (shouldUseWebOnly()) {
    return fetchWebDetailBySlug(slug);
  }

  let headers: Record<string, string>;
  try {
    headers = getAuthHeaders();
  } catch (error) {
    console.warn('[pionyr] API token missing, falling back to web scraping.', error);
    return fetchWebDetailBySlug(slug);
  }

  try {
    const candidates = cachedDetailPath ? [cachedDetailPath] : buildDetailPathCandidates();
    const { payload, resolvedPath } = await fetchDetail(candidates, slug, headers);
    if (!payload) {
      const list = await fetchPionyrArticles([]);
      return list.find((item) => item.slug === slug) ?? null;
    }
    cachedDetailPath = resolvedPath ?? cachedDetailPath;
    const data = payload.data ?? payload.item ?? payload.article ?? payload;
    const article = mapArticle(data);
    if (!article) {
      return null;
    }
    return article;
  } catch (error) {
    console.warn('[pionyr] API failed, falling back to web scraping.', error);
    return fetchWebDetailBySlug(slug);
  }
}
