import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchContentArticle, fetchContentArticles } from '../data/content';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('public article data', () => {
  it('requests a lightweight page with explicit limit and offset', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          articles: [
            {
              source: 'local',
              slug: 'prvni-clanek',
              title: 'První článek',
              excerpt: 'Krátký perex',
              dateISO: '2026-06-19T10:00:00.000Z',
            },
          ],
          hasMore: true,
          nextOffset: 24,
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const page = await fetchContentArticles({ limit: 12, offset: 12 });

    expect(fetchMock).toHaveBeenCalledWith('/api/content/articles?limit=12&offset=12');
    expect(page.articles).toHaveLength(1);
    expect(page.articles[0]?.body).toBeUndefined();
    expect(page.hasMore).toBe(true);
    expect(page.nextOffset).toBe(24);
  });

  it('loads full article content only from the detail endpoint', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          article: {
            source: 'pionyr',
            slug: 'článek 1',
            title: 'Detail článku',
            excerpt: 'Perex',
            dateISO: '2026-06-19T10:00:00.000Z',
            body: '<p>Celý text</p>',
            bodyFormat: 'html',
          },
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const article = await fetchContentArticle('článek 1');

    expect(fetchMock).toHaveBeenCalledWith('/api/content/articles/%C4%8Dl%C3%A1nek%201');
    expect(article?.body).toBe('<p>Celý text</p>');
  });
});
