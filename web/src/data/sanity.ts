import { createClient } from '@sanity/client';

const projectId = import.meta.env.VITE_SANITY_PROJECT_ID as string | undefined;
const dataset = import.meta.env.VITE_SANITY_DATASET as string | undefined;
const apiVersion = (import.meta.env.VITE_SANITY_API_VERSION as string | undefined) ?? '2024-06-01';

const isSanityConfigured = Boolean(projectId && dataset);

export type SanityImage = {
  url: string;
  alt?: string | null;
};

export type SanityArticle = {
  title: string;
  slug: string;
  publishedAt: string;
  excerpt?: string | null;
  coverImage?: SanityImage | null;
  body?: any[];
  author?: string | null;
};

export type SanityAlbum = {
  title: string;
  slug: string;
  date: string;
  schoolYear: string;
  driveFolderId: string;
  published: boolean;
  coverImage?: SanityImage | null;
};

export type SanityHomepage = {
  heroTitle?: string | null;
  heroSubtitle?: string | null;
  intro?: any[] | null;
  galleryIntro?: any[] | null;
  featuredAlbum?: SanityAlbum | null;
};

const client = isSanityConfigured
  ? createClient({
      projectId: projectId!,
      dataset: dataset!,
      apiVersion,
      useCdn: true,
    })
  : null;

export function hasSanityConfig() {
  return isSanityConfigured;
}

export async function fetchHomepage(): Promise<SanityHomepage | null> {
  if (!client) {
    return null;
  }
  return client.fetch(
    `*[_type == "homepage"][0]{
      heroTitle,
      heroSubtitle,
      intro[]{..., "asset": asset->},
      galleryIntro[]{..., "asset": asset->},
      featuredAlbum->{
        title,
        "slug": slug.current,
        date,
        schoolYear,
        driveFolderId,
        published,
        "coverImage": coverImage{alt, "url": asset->url}
      }
    }`,
  );
}

export async function fetchArticles(): Promise<SanityArticle[]> {
  if (!client) {
    return [];
  }
  return client.fetch(
    `*[_type == "article" && defined(slug.current) && publishedAt <= now()] | order(publishedAt desc) {
      title,
      "slug": slug.current,
      publishedAt,
      excerpt,
      author,
      body[]{..., "asset": asset->},
      "coverImage": coverImage{alt, "url": asset->url}
    }`,
  );
}

export async function fetchArticleBySlug(slug: string): Promise<SanityArticle | null> {
  if (!client) {
    return null;
  }
  return client.fetch(
    `*[_type == "article" && slug.current == $slug][0] {
      title,
      "slug": slug.current,
      publishedAt,
      excerpt,
      author,
      body[]{..., "asset": asset->},
      "coverImage": coverImage{alt, "url": asset->url}
    }`,
    { slug },
  );
}

export async function fetchAlbums(): Promise<SanityAlbum[]> {
  if (!client) {
    return [];
  }
  return client.fetch(
    `*[_type == "album" && published == true && defined(slug.current)] | order(date desc) {
      title,
      "slug": slug.current,
      date,
      schoolYear,
      driveFolderId,
      published,
      "coverImage": coverImage{alt, "url": asset->url}
    }`,
  );
}

export async function fetchAlbumBySlug(slug: string): Promise<SanityAlbum | null> {
  if (!client) {
    return null;
  }
  return client.fetch(
    `*[_type == "album" && slug.current == $slug][0] {
      title,
      "slug": slug.current,
      date,
      schoolYear,
      driveFolderId,
      published,
      "coverImage": coverImage{alt, "url": asset->url}
    }`,
    { slug },
  );
}
