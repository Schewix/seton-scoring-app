export type LoginErrorField = 'email' | 'password' | 'pin';

export interface LoginErrorFeedback {
  message: string;
  field?: LoginErrorField;
}

export function translateLoginError(error: unknown): LoginErrorFeedback {
  const message = (error instanceof Error ? error.message : String(error)).trim();
  const fallback: LoginErrorFeedback = {
    message: 'Nelze ověřit přihlášení. Zkontroluj připojení.',
  };

  if (!message) {
    return fallback;
  }

  const normalized = message.toLowerCase();

  if (normalized.includes('invalid credentials')) {
    return { message: 'Zadané údaje nejsou správné.', field: 'password' };
  }

  if (normalized.includes('invalid login response')) {
    return fallback;
  }

  if (normalized.includes('missing session identifier')) {
    return fallback;
  }

  if (normalized.includes('failed to fetch') || normalized.includes('request failed')) {
    return fallback;
  }

  if (normalized.includes('pin required')) {
    return { message: 'PIN je povinný pro toto stanoviště.', field: 'pin' };
  }

  if (normalized.includes('invalid pin')) {
    return { message: 'Zadané údaje nejsou správné.', field: 'pin' };
  }

  if (normalized.includes('invalid token')) {
    return fallback;
  }

  if (normalized.includes('chybí přístupový token')) {
    return fallback;
  }

  if (normalized.includes('přístupový token není platný jwt')) {
    return { message };
  }

  if (normalized.includes('účet není přiřazen')) {
    return { message };
  }

  if (normalized.includes('locked') || normalized.includes('suspended') || normalized.includes('blocked')) {
    return { message: 'Účet je dočasně zablokován. Zkuste to za 15 minut.', field: 'password' };
  }

  return fallback;
}
