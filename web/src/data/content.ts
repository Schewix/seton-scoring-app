export type ContentArticle = {
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

export type ContentArticlesPage = {
  articles: ContentArticle[];
  hasMore: boolean;
  nextOffset: number | null;
};

type FetchContentArticlesOptions = {
  limit?: number;
  offset?: number;
};

async function parseJson(response: Response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as Record<string, any>;
  } catch {
    return {};
  }
}

export async function fetchContentArticles({
  limit = 12,
  offset = 0,
}: FetchContentArticlesOptions = {}): Promise<ContentArticlesPage> {
  const params = new URLSearchParams({
    limit: String(limit),
    offset: String(offset),
  });
  const response = await fetch(`/api/content/articles?${params.toString()}`);
  if (!response.ok) {
    return { articles: [], hasMore: false, nextOffset: null };
  }
  const payload = (await parseJson(response)) as {
    articles?: ContentArticle[];
    hasMore?: boolean;
    nextOffset?: number | null;
  };
  return {
    articles: payload.articles ?? [],
    hasMore: payload.hasMore === true,
    nextOffset: typeof payload.nextOffset === 'number' ? payload.nextOffset : null,
  };
}

export async function fetchContentArticle(slug: string): Promise<ContentArticle | null> {
  const response = await fetch(`/api/content/articles/${encodeURIComponent(slug)}`);
  if (!response.ok) {
    return null;
  }
  const payload = (await parseJson(response)) as { article?: ContentArticle };
  return payload.article ?? null;
}
