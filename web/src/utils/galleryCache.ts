/**
 * Gallery Cache & Prefetch System
 * 
 * Prefetches gallery album previews in the background when user arrives on homepage.
 * Caches data in memory for 5 minutes, then automatically clears.
 */

export type GalleryPreview = {
  folderId: string;
  totalCount: number | null;
  files: Array<{
    fileId: string;
    name: string;
    thumbnailLink?: string | null;
    fullImageUrl?: string | null;
    webContentLink?: string | null;
  }>;
};

type CacheEntry = {
  data: GalleryPreview;
  timestamp: number;
};

type PendingRequest = {
  promise: Promise<GalleryPreview>;
  abortController: AbortController;
};

const CACHE_DURATION_MS = 5 * 60 * 1000; // 5 minutes
const cache = new Map<string, CacheEntry>();
const pendingRequests = new Map<string, PendingRequest>();
const cacheTimers = new Map<string, ReturnType<typeof setTimeout>>();

/**
 * Fetch album preview with deduplication.
 * If a request is already in flight, reuse it instead of making a new one.
 */
export function fetchAlbumPreview(folderId: string, signal?: AbortSignal): Promise<GalleryPreview> {
  // Check cache first
  const cached = cache.get(folderId);
  if (cached) {
    const age = Date.now() - cached.timestamp;
    if (age < CACHE_DURATION_MS) {
      return Promise.resolve(cached.data);
    }
    // Expired, remove it
    cache.delete(folderId);
    const timer = cacheTimers.get(folderId);
    if (timer) {
      clearTimeout(timer);
      cacheTimers.delete(folderId);
    }
  }

  // Check if there's already a pending request for this folder
  let pending = pendingRequests.get(folderId);
  if (pending) {
    // If a signal is provided and it's already aborted, reject
    if (signal?.aborted) {
      return Promise.reject(new DOMException('Aborted', 'AbortError'));
    }
    return pending.promise;
  }

  // Create new request
  const abortController = new AbortController();
  if (signal) {
    signal.addEventListener('abort', () => abortController.abort());
  }

  const params = new URLSearchParams({
    folderId,
    includeCount: '1',
    includeSubfolders: '1',
    pageSize: '8',
  });

  const promise = fetch(`/api/gallery?${params.toString()}`, {
    signal: abortController.signal,
  })
    .then((res) => {
      if (!res.ok) {
        throw new Error(`Gallery API error: ${res.status}`);
      }
      return res.json() as Promise<GalleryPreview>;
    })
    .then((data) => {
      const files = Array.isArray((data as any).files)
        ? (data as any).files
            .map((file: any) => {
              const fileId =
                typeof file?.fileId === 'string'
                  ? file.fileId
                  : typeof file?.id === 'string'
                    ? file.id
                    : '';
              if (!fileId) {
                return null;
              }
              return {
                fileId,
                name: typeof file?.name === 'string' ? file.name : '',
                thumbnailLink: typeof file?.thumbnailLink === 'string' ? file.thumbnailLink : null,
                fullImageUrl: typeof file?.fullImageUrl === 'string' ? file.fullImageUrl : null,
                webContentLink: typeof file?.webContentLink === 'string' ? file.webContentLink : null,
              };
            })
            .filter(
              (file): file is GalleryPreview['files'][number] =>
                Boolean(file && typeof file.fileId === 'string' && file.fileId.length > 0),
            )
        : [];

      const normalized: GalleryPreview = {
        folderId: typeof (data as any).folderId === 'string' ? (data as any).folderId : folderId,
        totalCount: typeof (data as any).totalCount === 'number' ? (data as any).totalCount : null,
        files,
      };

      // Store in cache
      cache.set(folderId, { data: normalized, timestamp: Date.now() });

      // Set up auto-clear timer
      const existingTimer = cacheTimers.get(folderId);
      if (existingTimer) {
        clearTimeout(existingTimer);
      }
      const timer = setTimeout(() => {
        cache.delete(folderId);
        cacheTimers.delete(folderId);
      }, CACHE_DURATION_MS);
      cacheTimers.set(folderId, timer);

      // Remove pending request
      pendingRequests.delete(folderId);

      return normalized;
    })
    .catch((error) => {
      // Remove pending request on error
      pendingRequests.delete(folderId);
      throw error;
    });

  pending = { promise, abortController };
  pendingRequests.set(folderId, pending);

  return promise;
}

/**
 * Prefetch multiple album previews in the background.
 * Requests are fired in parallel with minimal delay for responsiveness.
 * Low fetch priority to avoid blocking user interactions.
 */
export function prefetchAlbumPreviews(folderIds: string[]): void {
  folderIds.forEach((folderId, index) => {
    // Minimal delay: stagger first few requests to avoid thundering herd
    // but allow most to start immediately in parallel
    const delay = Math.min(index * 10, 50); // Max 50ms delay
    setTimeout(() => {
      fetchAlbumPreview(folderId).catch(() => {
        // Silently ignore errors during prefetch
      });
    }, delay);
  });
}

/**
 * Clear cache entry manually (useful for refresh scenarios)
 */
export function clearGalleryCache(folderId?: string): void {
  if (folderId) {
    cache.delete(folderId);
    const timer = cacheTimers.get(folderId);
    if (timer) {
      clearTimeout(timer);
      cacheTimers.delete(folderId);
    }
    const pending = pendingRequests.get(folderId);
    if (pending) {
      pending.abortController.abort();
      pendingRequests.delete(folderId);
    }
  } else {
    // Clear all
    cache.clear();
    cacheTimers.forEach((timer) => clearTimeout(timer));
    cacheTimers.clear();
    pendingRequests.forEach((pending) => pending.abortController.abort());
    pendingRequests.clear();
  }
}
