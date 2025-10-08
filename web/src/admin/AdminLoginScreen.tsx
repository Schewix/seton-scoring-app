import { useEffect, useState } from 'react';
import './AdminLoginScreen.css';
import { useAuth } from '../auth/context';
import AppFooter from '../components/AppFooter';
import zelenaLigaLogo from '../assets/znak_SPTO_transparent.png';
import { translateLoginError, type LoginErrorFeedback } from '../auth/loginErrors';
import { SCOREBOARD_ROUTE_PREFIX } from '../routing';

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

    setError(null);
    setLoading(true);
    try {
      await login({
        email: trimmedEmail,
        password,
        pin: trimmedPin ? trimmedPin : undefined,
      });
    } catch (err) {
      setError(translateLoginError(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="admin-login-page">
      <main className="admin-login-main">
        <div className="admin-login-layout">
          <section className="admin-login-hero" aria-label="Administrace závodu">
            <div className="admin-login-brand">
              <img src={zelenaLigaLogo} alt="Logo SPTO Brno" />
              <div className="admin-login-brand-text">
                <span className="admin-login-brand-name">SPTO Brno</span>
                <span className="admin-login-brand-caption">Součást Pionýra</span>
              </div>
            </div>
            <div className="admin-login-hero-copy">
              <h1>Administrace závodu</h1>
              <p>Správa závodu, stanovišť a výsledků.</p>
            </div>
            <ul className="admin-login-hero-list">
              <li>Správa závodních dat</li>
              <li>Export výsledků</li>
              <li>Přehled a kontrola stanovišť</li>
            </ul>
            <a
              className="admin-login-hero-link"
              href={SCOREBOARD_ROUTE_PREFIX}
            >
              Zobrazit výsledky Setonova závodu
            </a>
          </section>

          <form className="admin-login-card" onSubmit={handleSubmit} noValidate>
            <header className="admin-login-card-header">
              <h2>Přihlášení administrátora</h2>
              <p>Údaje získáš od hlavního správce závodu.</p>
            </header>

            {!isBrowserOnline ? (
              <div className="admin-login-offline" role="status">
                <span aria-hidden="true" />
                Připojení je offline. Pokus se znovu po obnovení.
              </div>
            ) : null}

            {error ? (
              <div className="admin-login-alert" role="alert">
                <span className="admin-login-alert-icon" aria-hidden="true">
                  !
                </span>
                <span>{error.message}</span>
              </div>
            ) : null}

            <div className="admin-login-field-group">
              <label className="admin-login-field" htmlFor={emailFieldId}>
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
                <p id={`${emailFieldId}-error`} className="admin-login-field-error">
                  {emailError}
                </p>
              ) : null}
            </div>

            <div className="admin-login-field-group">
              <label className="admin-login-field" htmlFor={passwordFieldId}>
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
                <p id={`${passwordFieldId}-error`} className="admin-login-field-error">
                  {passwordError}
                </p>
              ) : null}
            </div>

            <div className="admin-login-field-group">
              <label className="admin-login-field" htmlFor={pinFieldId}>
                <span>PIN / Zařízení (volitelné)</span>
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
                <p id={`${pinFieldId}-error`} className="admin-login-field-error">
                  {pinError}
                </p>
              ) : null}
            </div>

            <button type="submit" disabled={submitDisabled} className="admin-login-submit">
              {loading ? 'Přihlašuji…' : 'Přihlásit se'}
            </button>

            <div className="admin-login-links">
              <a className="admin-login-link" href="mailto:zavody@zelenaliga.cz">
                Zapomenuté heslo
              </a>
              <a className="admin-login-link" href="/">
                Zpět na Zelenou ligu
              </a>
            </div>
          </form>
        </div>
      </main>
      <AppFooter className="admin-login-footer" />
    </div>
  );
}
