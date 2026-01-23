import { getAccessToken } from './storage';

const WRAP_MARKER = '__setonAuthFetchWrapped';

function shouldWrapFetch(fetchFn: typeof fetch | undefined): fetchFn is typeof fetch {
  if (typeof fetchFn !== 'function') {
    return false;
  }
  return !(fetchFn as typeof fetch & { [WRAP_MARKER]?: boolean })[WRAP_MARKER];
}

if (shouldWrapFetch(globalThis.fetch)) {
  const nativeFetch = globalThis.fetch;
  const wrappedFetch: typeof fetch & { [WRAP_MARKER]?: boolean } = async (input, init) => {
    const accessToken = await getAccessToken();
    if (!accessToken) {
      return nativeFetch(input, init);
    }

    const baseHeaders = init?.headers ?? (input instanceof Request ? input.headers : undefined);
    const headers = new Headers(baseHeaders);

    if (!headers.has('Authorization')) {
      headers.set('Authorization', `Bearer ${accessToken}`);
    }

    const nextInit: RequestInit = { ...init, headers };

    if (input instanceof Request) {
      return nativeFetch(new Request(input, nextInit));
    }

    return nativeFetch(input, nextInit);
  };

  wrappedFetch[WRAP_MARKER] = true;
  globalThis.fetch = wrappedFetch;
}
