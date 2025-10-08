import { useEffect, useState } from 'react';
import { useAuth } from './context';
import zelenaLigaLogo from '../assets/znak_SPTO_transparent.png';
import AppFooter from '../components/AppFooter';

interface Props {
  requirePinOnly?: boolean;
}

type LoginErrorField = 'email' | 'password' | 'pin';

interface LoginErrorFeedback {
  message: string;
  field?: LoginErrorField;
}

function translateLoginError(error: unknown) {
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
    return { message: 'Zadané údaje nejsou správné.', field: 'pin' };
  }

  if (normalized.includes('invalid pin')) {
    return { message: 'Zadané údaje nejsou správné.', field: 'pin' };
  }

  if (normalized.includes('invalid token')) {
    return fallback;
  }

  if (normalized.includes('locked') || normalized.includes('suspended') || normalized.includes('blocked')) {
    return { message: 'Účet je dočasně zablokován. Zkuste to za 15 minut.', field: 'password' };
  }

  return fallback;
}

export default function LoginScreen({ requirePinOnly }: Props) {
  const { login, unlock } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState<LoginErrorFeedback | null>(null);
  const [loading, setLoading] = useState(false);
  const [isBrowserOnline, setIsBrowserOnline] = useState(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true,
  );

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    const handleOnline = () => setIsBrowserOnline(true);
    const handleOffline = () => setIsBrowserOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const hasEmail = email.trim().length > 0;
  const hasPassword = password.length > 0;
  const hasPin = pin.trim().length > 0;
  const isFormValid = requirePinOnly ? hasPin : hasEmail && hasPassword;
  const submitDisabled = loading || !isFormValid;
  const submitLabel = requirePinOnly ? 'Odemknout' : 'Přihlásit';
  const loadingLabel = requirePinOnly ? 'Odemykám…' : 'Přihlašuji…';

  const formTitle = requirePinOnly ? 'Odemknutí stanoviště' : 'Přihlášení administrátora';
  const heroHeading = requirePinOnly ? 'Stanoviště' : 'Admin – Setonův závod';
  const heroDescription = requirePinOnly
    ? 'Odemkni uložené stanoviště Setonova závodu pomocí PINu a pokračuj i bez připojení.'
    : 'Spravuj závod, výsledky i uživatele v bezpečném admin rozhraní.';
  const heroListItems = requirePinOnly
    ? [
      'Přihlášení pro rozhodčí stanovišť',
      'Offline režim se synchronizací výsledků',
      'Rychlé obnovení stanoviště pomocí PINu',
    ]
    : [
      'Správa stanovišť a rozhodčích',
      'Kontrola a export výsledků závodu',
      'Správa uživatelů a přístupů',
    ];
  const descriptionText = requirePinOnly
    ? 'Zadej PIN pro odemknutí uloženého stanoviště.'
    : 'Přihlaste se e-mailem a heslem, které jste obdrželi od koordinátora závodu.';
  const descriptionId = requirePinOnly ? 'login-description-pin' : 'login-description';

  const emailFieldId = 'login-email';
  const passwordFieldId = 'login-password';
  const pinFieldId = 'login-pin';

  const emailError = error?.field === 'email' ? error.message : null;
  const passwordError = error?.field === 'password' ? error.message : null;
  const pinError = error?.field === 'pin' ? error.message : null;
  const showOfflineNotice = !isBrowserOnline;

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!isFormValid) {
      return;
    }

    const trimmedEmail = email.trim();
    const trimmedPin = pin.trim();

    setError(null);
    setLoading(true);
    try {
      if (requirePinOnly) {
        await unlock(trimmedPin);
      } else {
        await login({
          email: trimmedEmail,
          password,
          pin: trimmedPin ? trimmedPin : undefined,
        });
      }
    } catch (err) {
      setError(translateLoginError(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-shell">
      <header className="auth-header" aria-label="Navigace administrace">
        <div className="auth-header-inner">
          <a
            className="auth-header-brand"
            href="https://zelenaliga.cz"
            target="_blank"
            rel="noreferrer"
          >
            <img src={zelenaLigaLogo} alt="Logo SPTO Brno" />
            <span>SPTO Brno</span>
          </a>
          <a className="auth-header-link" href="/">
            Zpět na Zelenou ligu
          </a>
        </div>
      </header>
      <div className="auth-shell-content">
        <div className="auth-layout">
          <div className="auth-hero-wrap">
            <section className="auth-hero" aria-label="Informace pro rozhodčí">
              <div className="auth-hero-brand">
                <div className="auth-hero-logo" aria-hidden="true">
                  <img src={zelenaLigaLogo} alt="" />
                </div>
                <span className="auth-hero-caption">SPTO Brno</span>
              </div>
              <div className="auth-hero-copy">
                <span className="auth-hero-eyebrow">Setonův závod</span>
                <h1>{heroHeading}</h1>
                {heroDescription && <p>{heroDescription}</p>}
              </div>
              <ul className="auth-hero-list">
                {heroListItems.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
              <a className="auth-hero-secondary" href={SCOREBOARD_ROUTE_PREFIX}>
                Otevřít výsledky
              </a>
            </section>
          </div>

          <form
            className="auth-card"
            onSubmit={handleSubmit}
            aria-describedby={descriptionId}
            noValidate
          >
            {showOfflineNotice ? (
              <div className="auth-offline-banner" role="status">
                <span className="auth-offline-indicator" aria-hidden="true" />
                Jste offline – přihlášení se uloží a odešle po připojení.
              </div>
            ) : null}
            <h2>{formTitle}</h2>
            <p id={descriptionId} className="auth-description">
              {descriptionText}
            </p>
            {error ? (
              <div className="auth-alert auth-alert--error" role="alert">
                <span className="auth-alert-icon" aria-hidden="true">
                  !
                </span>
                <span>{error.message}</span>
              </div>
            ) : null}

            {!requirePinOnly ? (
              <div className="auth-field-group">
                <label className="auth-field" htmlFor={emailFieldId}>
                  <span>E-mail</span>
                  <input
                    id={emailFieldId}
                    type="email"
                    inputMode="email"
                    autoComplete="username"
                    value={email}
                    onChange={(event) => {
                      setEmail(event.target.value);
                      setError((current) => (current && current.field === 'email' ? null : current));
                    }}
                    placeholder="jan.novak@…"
                    required
                    aria-invalid={emailError ? 'true' : 'false'}
                    aria-describedby={emailError ? `${emailFieldId}-error` : undefined}
                  />
                </label>
                {emailError ? (
                  <p id={`${emailFieldId}-error`} className="auth-field-error">
                    {emailError}
                  </p>
                ) : null}
              </div>
            ) : null}

            {!requirePinOnly ? (
              <div className="auth-field-group">
                <label className="auth-field" htmlFor={passwordFieldId}>
                  <span>Heslo</span>
                  <input
                    id={passwordFieldId}
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(event) => {
                      setPassword(event.target.value);
                      setError((current) =>
                        current && current.field === 'password' ? null : current,
                      );
                    }}
                    placeholder="••••••••"
                    required
                    aria-invalid={passwordError ? 'true' : 'false'}
                    aria-describedby={passwordError ? `${passwordFieldId}-error` : undefined}
                  />
                </label>
                {passwordError ? (
                  <p id={`${passwordFieldId}-error`} className="auth-field-error">
                    {passwordError}
                  </p>
                ) : null}
              </div>
            ) : null}

            <div className="auth-field-group">
              <label className="auth-field" htmlFor={pinFieldId}>
                <span>{requirePinOnly ? 'PIN' : 'PIN (volitelné)'}</span>
                <input
                  id={pinFieldId}
                  type="password"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={6}
                  value={pin}
                  onChange={(event) => {
                    const raw = event.target.value.replace(/[^0-9]/g, '');
                    setPin(raw);
                    setError((current) => (current && current.field === 'pin' ? null : current));
                  }}
                  placeholder="např. 1234"
                  required={requirePinOnly}
                  aria-invalid={pinError ? 'true' : 'false'}
                  aria-describedby={pinError ? `${pinFieldId}-error` : undefined}
                />
              </label>
              {pinError ? (
                <p id={`${pinFieldId}-error`} className="auth-field-error">
                  {pinError}
                </p>
              ) : null}
            </div>

            <button type="submit" disabled={submitDisabled} className="auth-primary">
              {loading ? loadingLabel : submitLabel}
            </button>
            <div className="auth-links">
              <a className="auth-link" href="mailto:zavody@zelenaliga.cz">
                Zapomenuté heslo
              </a>
              <a className="auth-link" href="/">
                Zpět na Zelenou ligu
              </a>
            </div>
          </form>
        </div>
      </div>
      <AppFooter variant="minimal" className="auth-footer" />
    </div>
  );
}
