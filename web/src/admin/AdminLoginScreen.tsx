import { useEffect, useState } from 'react';
import '../styles/LoginPage.css';
import { useAuth } from '../auth/context';
import AppFooter from '../components/AppFooter';
import zelenaLigaLogo from '../assets/znak_SPTO_transparent.png';
import { translateLoginError, type LoginErrorFeedback } from '../auth/loginErrors';
import { FORGOT_PASSWORD_ROUTE } from '../routing';

export default function AdminLoginScreen() {
  const { login } = useAuth();
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
  const submitDisabled = loading || !hasEmail || !hasPassword;

  const emailFieldId = 'admin-login-email';
  const passwordFieldId = 'admin-login-password';
  const pinFieldId = 'admin-login-pin';

  const emailError = error?.field === 'email' ? error.message : null;
  const passwordError = error?.field === 'password' ? error.message : null;
  const pinError = error?.field === 'pin' ? error.message : null;

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!hasEmail || !hasPassword) {
      return;
    }

    const trimmedEmail = email.trim();
    const trimmedPin = pin.trim();
    const loginPin = trimmedPin.length ? trimmedPin : undefined;

    setError(null);
    setLoading(true);
    try {
      await login({
        email: trimmedEmail,
        password,
        pin: loginPin,
      });
    } catch (err) {
      setError(translateLoginError(err));
    } finally {
      setLoading(false);
    }
  };

  const heroItems = ['Správa dat závodu', 'Export výsledků', 'Přehled stanovišť'];

  return (
    <div className="login-page login-page--admin">
      <main className="login-main">
        <div className="login-layout">
          <section className="login-hero" aria-label="Administrace závodu">
            <div className="login-hero-brand">
              <img src={zelenaLigaLogo} alt="Logo SPTO Brno" className="login-hero-logo" />
              <div className="login-hero-brand-text">
                <span className="login-hero-brand-name">SPTO BRNO</span>
                <span className="login-hero-brand-caption">Součást Pionýra</span>
              </div>
            </div>
            <div className="login-hero-copy">
              <span className="login-hero-eyebrow">Setonův závod</span>
              <h1>Administrace závodu</h1>
              <p>Správa závodu, stanovišť a výsledků.</p>
            </div>
            <ul className="login-hero-list">
              {heroItems.map((item) => (
                <li key={item} className="login-hero-list-item">
                  {item}
                </li>
              ))}
            </ul>
          </section>

          <form className="login-card" onSubmit={handleSubmit} noValidate>
            <header>
              <h2>Přihlášení administrátora</h2>
              <p className="login-card-description">Údaje získáš od hlavního správce závodu.</p>
            </header>

            {!isBrowserOnline ? (
              <div className="login-offline" role="status">
                <span className="login-offline-indicator" aria-hidden="true" />
                Připojení je offline. Pokus se znovu po obnovení.
              </div>
            ) : null}

            {error ? (
              <div className="login-alert login-alert--error" role="alert">
                <span className="login-alert-icon" aria-hidden="true">!</span>
                <span>{error.message}</span>
              </div>
            ) : null}

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
                    setError((current) => (current && current.field === 'password' ? null : current));
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

            <div className="login-field-group">
              <label className="login-field" htmlFor={pinFieldId}>
                <span>PIN (volitelné)</span>
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
              {loading ? 'Přihlašuji…' : 'Přihlásit se'}
            </button>

            <div className="login-links">
              <a className="login-link" href={FORGOT_PASSWORD_ROUTE}>
                Zapomenuté heslo
              </a>
              <a className="login-link login-link--muted" href="/">
                Zpět na Zelenou ligu
              </a>
            </div>
          </form>
        </div>
      </main>
      <AppFooter className="login-footer" />
    </div>
  );
}
