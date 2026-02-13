export type ParsedBoardQr = {
  shortCode: string;
  eventSlug: string | null;
};

const SHORT_CODE_RE = /^(?=.*[A-Z])(?=.*[0-9])[A-Z0-9]{4,24}$/;

function normalizeCode(value: string): string | null {
  const normalized = value.trim().toUpperCase();
  if (!SHORT_CODE_RE.test(normalized)) {
    return null;
  }
  return normalized;
}

export function parseBoardQrPayload(raw: string): ParsedBoardQr | null {
  const value = raw.trim();
  if (!value) {
    return null;
  }

  const tokenMatch = value.match(/^ZL:([^:]+):([^:]+)$/i);
  if (tokenMatch) {
    const eventSlug = tokenMatch[1]?.trim().toLowerCase();
    const shortCode = normalizeCode(tokenMatch[2] ?? '');
    if (!shortCode) {
      return null;
    }
    return {
      shortCode,
      eventSlug: eventSlug || null,
    };
  }

  try {
    const url = new URL(value);
    const parts = url.pathname.split('/').filter(Boolean);
    const pIndex = parts.findIndex((part) => part.toLowerCase() === 'p');
    if (pIndex >= 0 && pIndex + 1 < parts.length) {
      const shortCode = normalizeCode(parts[pIndex + 1]);
      if (!shortCode) {
        return null;
      }
      const eventSlug = parts[pIndex - 1]?.toLowerCase() ?? null;
      return { shortCode, eventSlug };
    }

    const last = parts[parts.length - 1] ?? '';
    const shortCode = normalizeCode(last);
    if (!shortCode) {
      return null;
    }
    return {
      shortCode,
      eventSlug: null,
    };
  } catch {
    const shortCode = normalizeCode(value);
    if (!shortCode) {
      return null;
    }
    return {
      shortCode,
      eventSlug: null,
    };
  }
}

export function buildBoardQrPayload(shortCode: string): string {
  const normalized = normalizeCode(shortCode) ?? shortCode.trim().toUpperCase();
  return `https://zelenaliga.cz/deskovky/p/${normalized}`;
}
