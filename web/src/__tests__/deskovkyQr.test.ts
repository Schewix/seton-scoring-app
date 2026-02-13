import { describe, expect, it } from 'vitest';
import { parseBoardQrPayload } from '../features/deskovky/qr';

describe('parseBoardQrPayload', () => {
  it('parses ZL payload', () => {
    expect(parseBoardQrPayload('ZL:deskovky-2026:A7K3F2')).toEqual({
      eventSlug: 'deskovky-2026',
      shortCode: 'A7K3F2',
    });
  });

  it('parses URL payload with /p/short_code', () => {
    expect(parseBoardQrPayload('https://zelenaliga.cz/deskovky/p/a7k3f2')).toEqual({
      eventSlug: 'deskovky',
      shortCode: 'A7K3F2',
    });
  });

  it('returns null for invalid payload', () => {
    expect(parseBoardQrPayload('not-a-valid-code')).toBeNull();
  });
});
