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

async function parseJson(response: Response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as Record<string, any>;
  } catch {
    return {};
  }
}

export async function fetchContentArticles(): Promise<ContentArticle[]> {
  const response = await fetch('/api/content/articles');
  if (!response.ok) {
    return [];
  }
  const payload = (await parseJson(response)) as { articles?: ContentArticle[] };
  return payload.articles ?? [];
}

export async function fetchContentArticle(slug: string): Promise<ContentArticle | null> {
  const response = await fetch(`/api/content/articles/${slug}`);
  if (!response.ok) {
    return null;
  }
  const payload = (await parseJson(response)) as { article?: ContentArticle };
  return payload.article ?? null;
}
