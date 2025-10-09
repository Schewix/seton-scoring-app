import { useEffect, useState } from 'react';
import '../styles/LoginPage.css';
import { useAuth } from './context';
import zelenaLigaLogo from '../assets/znak_SPTO_transparent.png';
import AppFooter from '../components/AppFooter';
import { ADMIN_ROUTE_PREFIX } from '../routing';
import { translateLoginError, type LoginErrorFeedback } from './loginErrors';

interface Props {
  requirePinOnly?: boolean;
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

  const formTitle = requirePinOnly ? 'Odemknutí stanoviště' : 'Přihlášení rozhodčího';
  const heroTitle = requirePinOnly ? 'Setonův závod – Stanoviště' : 'Setonův závod – Rozhodčí';
  const heroSubtitle = requirePinOnly
    ? 'Odemkni uložené stanoviště Setonova závodu a pokračuj i bez připojení.'
    : 'Záznam výsledků ze stanovišť závodu.';
  const heroItems = requirePinOnly
    ? [
        'Práce v offline režimu',
        'Bezpečné odemknutí pomocí PINu',
        'Automatická synchronizace výsledků',
      ]
    : [
        'Přihlášení rozhodčích stanovišť',
        'Offline režim se synchronizací',
        'Export výsledků do tabulek',
      ];
  const descriptionText = requirePinOnly
    ? 'Zadej PIN pro odemknutí uloženého stanoviště.'
    : 'Přihlašovací údaje získáš od hlavního rozhodčího.';
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
    <div className="login-page login-page--referee">
      <div className="login-main">
        <div className="login-layout">
          <section className="login-hero" aria-label="Informace pro rozhodčí">
            <div className="login-hero-brand">
              <img src={zelenaLigaLogo} alt="Logo SPTO Brno" className="login-hero-logo" />
              <div className="login-hero-brand-text">
                <span className="login-hero-brand-name">SPTO BRNO</span>
                <span className="login-hero-brand-caption">Součást Pionýra</span>
              </div>
            </div>
            <div className="login-hero-copy">
              <span className="login-hero-eyebrow">Setonův závod</span>
              <h1>{heroTitle}</h1>
              <p>{heroSubtitle}</p>
            </div>
            <ul className="login-hero-list">
              {heroItems.map((item) => (
                <li key={item} className="login-hero-list-item">
                  <span className="login-hero-list-icon" aria-hidden="true">
                    ✅
                  </span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
            <a className="login-hero-button" href={ADMIN_ROUTE_PREFIX} target="_blank" rel="noreferrer">
              <span>Přihlášení pro kancelář závodu</span>
              <span className="login-hero-button-icon" aria-hidden="true">
                →
              </span>
            </a>
          </section>

          <form
            className="login-card"
            onSubmit={handleSubmit}
            aria-describedby={descriptionId}
            noValidate
          >
            {showOfflineNotice ? (
              <div className="login-offline" role="status">
                <span className="login-offline-indicator" aria-hidden="true" />
                Jste offline – přihlášení se uloží a odešle po připojení.
              </div>
            ) : null}
            <h2>{formTitle}</h2>
            <p id={descriptionId} className="login-card-description">
              {descriptionText}
            </p>
            {error ? (
              <div className="login-alert login-alert--error" role="alert">
                <span className="login-alert-icon" aria-hidden="true">!</span>
                <span>{error.message}</span>
              </div>
            ) : null}

            {!requirePinOnly ? (
              <div className="login-field-group">
                <label className="login-field" htmlFor={emailFieldId}>
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
                  <p id={`${emailFieldId}-error`} className="login-field-error">
                    {emailError}
                  </p>
                ) : null}
              </div>
            ) : null}

            {!requirePinOnly ? (
              <div className="login-field-group">
                <label className="login-field" htmlFor={passwordFieldId}>
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
                  <p id={`${passwordFieldId}-error`} className="login-field-error">
                    {passwordError}
                  </p>
                ) : null}
              </div>
            ) : null}

            <div className="login-field-group">
              <label className="login-field" htmlFor={pinFieldId}>
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
                <p id={`${pinFieldId}-error`} className="login-field-error">
                  {pinError}
                </p>
              ) : null}
            </div>

            <button type="submit" disabled={submitDisabled} className="login-primary">
              {loading ? loadingLabel : submitLabel}
            </button>
            <div className="login-links">
              <a className="login-link" href="mailto:zavody@zelenaliga.cz">
                Zapomenuté heslo
              </a>
              <a className="login-link login-link--muted" href="/">
                Zpět na Zelenou ligu
              </a>
            </div>
          </form>
        </div>
      </div>
      <AppFooter variant="minimal" className="login-footer" />
    </div>
  );
}
