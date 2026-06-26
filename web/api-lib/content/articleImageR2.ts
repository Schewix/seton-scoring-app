import { HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { createHash } from 'node:crypto';
import { JSDOM } from 'jsdom';
import sharp from 'sharp';
import type { PionyrArticle } from './pionyr.js';

type ArticleImageR2Config = {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  publicBaseUrl: string;
  prefix: string;
  maxSourceBytes: number;
  fetchTimeoutMs: number;
};

type CachedArticleImage = {
  sourceUrl: string;
  variants: Map<number, string>;
};

const ARTICLE_IMAGE_VARIANT_WIDTHS = [360, 720, 1200] as const;
const ARTICLE_IMAGE_DEFAULT_PREFIX = 'articles/pionyr';
const ARTICLE_IMAGE_CACHE_CONTROL = 'public, max-age=31536000, immutable';
const ARTICLE_IMAGE_DEFAULT_MAX_SOURCE_BYTES = 60 * 1024 * 1024;
const ARTICLE_IMAGE_FETCH_TIMEOUT_MS = 45_000;
const ARTICLE_IMAGE_CONCURRENCY = 1;
const BYTES_PER_MEGABYTE = 1024 * 1024;
const ARTICLE_IMAGE_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

let cachedS3Client: { cacheKey: string; client: S3Client } | null = null;

function readEnv(name: string): string {
  return (process.env[name] ?? '').trim();
}

function readPositiveNumberEnv(name: string, fallback: number): number {
  const value = Number(readEnv(name));
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function normalizePrefix(raw: string): string {
  const prefix = raw.trim().replace(/^\/+|\/+$/g, '');
  return prefix || ARTICLE_IMAGE_DEFAULT_PREFIX;
}

function normalizeObjectKey(raw: string): string {
  return raw.trim().replace(/^\/+/, '');
}

function getArticleImageR2Config(): ArticleImageR2Config | null {
  const accountId = readEnv('CLOUDFLARE_R2_ACCOUNT_ID');
  const accessKeyId = readEnv('CLOUDFLARE_R2_ACCESS_KEY_ID');
  const secretAccessKey = readEnv('CLOUDFLARE_R2_SECRET_ACCESS_KEY');
  const bucket = readEnv('CONTENT_ARTICLE_R2_BUCKET') || readEnv('CLOUDFLARE_R2_BUCKET');
  const publicBaseUrl =
    readEnv('CONTENT_ARTICLE_R2_PUBLIC_BASE_URL') ||
    readEnv('GALLERY_R2_PUBLIC_BASE_URL') ||
    readEnv('CLOUDFLARE_R2_PUBLIC_BASE_URL');
  const maxSourceMegabytes = readPositiveNumberEnv(
    'CONTENT_ARTICLE_IMAGE_MAX_SOURCE_MB',
    ARTICLE_IMAGE_DEFAULT_MAX_SOURCE_BYTES / BYTES_PER_MEGABYTE,
  );

  if (!accountId || !accessKeyId || !secretAccessKey || !bucket || !publicBaseUrl) {
    return null;
  }

  return {
    accountId,
    accessKeyId,
    secretAccessKey,
    bucket,
    publicBaseUrl: publicBaseUrl.replace(/\/+$/, ''),
    prefix: normalizePrefix(readEnv('CONTENT_ARTICLE_R2_PREFIX') || ARTICLE_IMAGE_DEFAULT_PREFIX),
    maxSourceBytes: Math.round(maxSourceMegabytes * BYTES_PER_MEGABYTE),
    fetchTimeoutMs: ARTICLE_IMAGE_FETCH_TIMEOUT_MS,
  };
}

function getS3Client(config: ArticleImageR2Config): S3Client {
  const cacheKey = `${config.accountId}:${config.accessKeyId}`;
  if (cachedS3Client?.cacheKey === cacheKey) {
    return cachedS3Client.client;
  }

  const client = new S3Client({
    region: 'auto',
    endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });
  cachedS3Client = { cacheKey, client };
  return client;
}

function toPublicUrl(config: ArticleImageR2Config, objectKey: string): string {
  const cleanKey = normalizeObjectKey(objectKey);
  return `${config.publicBaseUrl}/${cleanKey.split('/').map(encodeURIComponent).join('/')}`;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function isCacheableRemoteImageUrl(url: string): boolean {
  if (!/^https?:\/\//i.test(url)) {
    return false;
  }
  if (url.includes('images.weserv.nl/')) {
    return false;
  }
  return true;
}

function createImageBaseKey(config: ArticleImageR2Config, articleSlug: string, sourceUrl: string): string {
  const articlePath = slugify(articleSlug) || 'article';
  const sourceHash = createHash('sha256').update(sourceUrl).digest('hex').slice(0, 20);
  return `${config.prefix}/${articlePath}/${sourceHash}`;
}

function createVariantKey(baseKey: string, width: number): string {
  return `${baseKey}-w${width}.webp`;
}

async function objectExists(s3: S3Client, bucket: string, key: string): Promise<boolean> {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return true;
  } catch (error) {
    const statusCode = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
    if (statusCode === 404) {
      return false;
    }
    throw error;
  }
}

async function downloadImage(sourceUrl: string, config: ArticleImageR2Config): Promise<Buffer> {
  const response = await fetch(sourceUrl, {
    signal: AbortSignal.timeout(config.fetchTimeoutMs),
    headers: {
      Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
      Referer: 'https://pionyr.cz/',
      'User-Agent': ARTICLE_IMAGE_USER_AGENT,
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const contentType = response.headers.get('content-type') ?? '';
  if (contentType && !contentType.toLowerCase().startsWith('image/')) {
    throw new Error(`Unexpected content type "${contentType}"`);
  }

  const contentLength = Number(response.headers.get('content-length') ?? 0);
  if (Number.isFinite(contentLength) && contentLength > config.maxSourceBytes) {
    throw new Error(`Image is too large (${contentLength} bytes, max ${config.maxSourceBytes} bytes)`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.byteLength > config.maxSourceBytes) {
    throw new Error(`Image is too large (${buffer.byteLength} bytes, max ${config.maxSourceBytes} bytes)`);
  }
  return buffer;
}

async function optimizeImageVariant(input: Buffer, width: number): Promise<Buffer> {
  return sharp(input)
    .rotate()
    .resize({ width, withoutEnlargement: true })
    .webp({ quality: width <= 360 ? 76 : 80, effort: 4, smartSubsample: true })
    .toBuffer();
}

async function uploadImageVariant(params: {
  s3: S3Client;
  bucket: string;
  key: string;
  body: Buffer;
}) {
  await params.s3.send(
    new PutObjectCommand({
      Bucket: params.bucket,
      Key: params.key,
      Body: params.body,
      ContentType: 'image/webp',
      CacheControl: ARTICLE_IMAGE_CACHE_CONTROL,
    }),
  );
}

async function cacheImageVariants(
  config: ArticleImageR2Config,
  sourceUrl: string,
  articleSlug: string,
): Promise<CachedArticleImage | null> {
  if (!isCacheableRemoteImageUrl(sourceUrl)) {
    return null;
  }

  const s3 = getS3Client(config);
  const baseKey = createImageBaseKey(config, articleSlug, sourceUrl);
  const keys = ARTICLE_IMAGE_VARIANT_WIDTHS.map((width) => ({
    width,
    key: createVariantKey(baseKey, width),
  }));
  const variants = new Map(keys.map(({ width, key }) => [width, toPublicUrl(config, key)]));

  const missingKeys = [];
  for (const item of keys) {
    if (!(await objectExists(s3, config.bucket, item.key))) {
      missingKeys.push(item);
    }
  }

  if (missingKeys.length > 0) {
    const input = await downloadImage(sourceUrl, config);
    for (const { width, key } of missingKeys) {
      const body = await optimizeImageVariant(input, width);
      await uploadImageVariant({ s3, bucket: config.bucket, key, body });
    }
  }

  return { sourceUrl, variants };
}

function getVariantUrl(cached: CachedArticleImage | null | undefined, preferredWidth: number): string | null {
  if (!cached) {
    return null;
  }
  if (cached.variants.has(preferredWidth)) {
    return cached.variants.get(preferredWidth) ?? null;
  }
  const widths = Array.from(cached.variants.keys()).sort((a, b) => a - b);
  const fallbackWidth = widths.find((width) => width >= preferredWidth) ?? widths.at(-1);
  return fallbackWidth ? cached.variants.get(fallbackWidth) ?? null : null;
}

function getImageSourcesFromHtml(html: string): string[] {
  const dom = new JSDOM(html);
  const images = Array.from(dom.window.document.querySelectorAll('img'));
  return images
    .map((image) => image.getAttribute('src')?.trim() ?? '')
    .filter(Boolean);
}

function replaceImageSourcesInHtml(html: string, cachedImages: Map<string, CachedArticleImage>): string {
  const dom = new JSDOM(html);
  const images = Array.from(dom.window.document.querySelectorAll('img'));
  let changed = false;

  images.forEach((image) => {
    const sourceUrl = image.getAttribute('src')?.trim() ?? '';
    const cached = cachedImages.get(sourceUrl);
    const replacement = getVariantUrl(cached, 1200);
    if (!replacement) {
      return;
    }
    image.setAttribute('src', replacement);
    image.removeAttribute('srcset');
    image.removeAttribute('sizes');
    changed = true;
  });

  return changed ? dom.window.document.body.innerHTML : html;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  mapper: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapper(items[currentIndex]);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

export async function cachePionyrArticleImages(article: PionyrArticle): Promise<PionyrArticle> {
  const config = getArticleImageR2Config();
  if (!config) {
    return article;
  }

  const sourceUrls = new Set<string>();
  if (article.coverImageUrl) {
    sourceUrls.add(article.coverImageUrl);
  }
  if (article.bodyHtml) {
    getImageSourcesFromHtml(article.bodyHtml).forEach((url) => sourceUrls.add(url));
  }

  const urls = Array.from(sourceUrls).filter(isCacheableRemoteImageUrl);
  if (urls.length === 0) {
    return article;
  }

  const cachedEntries = await mapWithConcurrency(urls, ARTICLE_IMAGE_CONCURRENCY, async (sourceUrl) => {
    try {
      return await cacheImageVariants(config, sourceUrl, article.slug);
    } catch (error) {
      console.warn(
        `[api/content/import] failed to cache article image ${sourceUrl}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return null;
    }
  });

  const cachedImages = new Map<string, CachedArticleImage>();
  cachedEntries.forEach((entry) => {
    if (entry) {
      cachedImages.set(entry.sourceUrl, entry);
    }
  });

  if (cachedImages.size === 0) {
    return article;
  }

  const coverImageUrl =
    getVariantUrl(article.coverImageUrl ? cachedImages.get(article.coverImageUrl) : null, 720) ??
    article.coverImageUrl;
  const bodyHtml = article.bodyHtml ? replaceImageSourcesInHtml(article.bodyHtml, cachedImages) : article.bodyHtml;

  return {
    ...article,
    coverImageUrl,
    bodyHtml,
  };
}
