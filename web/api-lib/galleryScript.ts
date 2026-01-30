type ScriptItemType = 'folder' | 'image';

type ScriptItem = {
  id: string;
  name: string;
  type: ScriptItemType;
  src?: string;
  thumb?: string;
};

function getScriptUrl(): string | null {
  const raw = process.env.GOOGLE_DRIVE_SCRIPT_URL;
  if (!raw) {
    return null;
  }
  return raw.trim() || null;
}

export function hasGalleryScript(): boolean {
  return Boolean(getScriptUrl());
}

export async function fetchScriptItems(folderId?: string): Promise<ScriptItem[]> {
  const scriptUrl = getScriptUrl();
  if (!scriptUrl) {
    throw new Error('Missing GOOGLE_DRIVE_SCRIPT_URL environment variable.');
  }

  const url = new URL(scriptUrl);
  if (folderId) {
    url.searchParams.set('id', folderId);
  }

  const response = await fetch(url.toString(), {
    headers: {
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`Gallery script error: ${response.status}`);
  }

  const payload = (await response.json()) as ScriptItem[] | { error?: string };
  if (Array.isArray(payload)) {
    return payload.filter((item) => item && typeof item.id === 'string' && item.id.length > 0);
  }
  if (payload && typeof payload === 'object' && 'error' in payload) {
    throw new Error(`Gallery script error: ${payload.error ?? 'unknown'}`);
  }
  return [];
}
