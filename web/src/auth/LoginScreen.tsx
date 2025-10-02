import { useState } from 'react';
import { useAuth } from './context';
import zelenaLigaLogo from '../assets/znak_SPTO_transparent.png';
import AppFooter from '../components/AppFooter';

interface Props {
  requirePinOnly?: boolean;
}

function translateLoginError(error: unknown) {
  const message = (error instanceof Error ? error.message : String(error)).trim();
  if (!message) {
    return 'Nepodařilo se dokončit přihlášení. Zkus to prosím znovu.';
  }

  const normalized = message.toLowerCase();

  if (normalized.includes('invalid credentials')) {
    return 'Nesprávný e-mail, heslo nebo PIN.';
  }

  if (normalized.includes('invalid login response')) {
    return 'Server vrátil neplatnou odpověď. Kontaktuj prosím administrátora.';
  }

  if (normalized.includes('missing session identifier')) {
    return 'Chybí identifikátor relace. Kontaktuj prosím administrátora.';
  }

  if (normalized.includes('failed to fetch') || normalized.includes('request failed')) {
    return 'Nepodařilo se spojit se serverem. Zkontroluj připojení a zkus to znovu.';
  }

  if (normalized.includes('pin required')) {
    return 'Zadej prosím PIN.';
  }

  if (normalized.includes('invalid pin')) {
    return 'Zadaný PIN není správný.';
  }

  if (normalized.includes('invalid token')) {
    return 'Server vrátil neplatný přístupový token. Kontaktuj prosím administrátora.';
  }

  return 'Nepodařilo se dokončit přihlášení. Zkus to prosím znovu.';
}

export default function LoginScreen({ requirePinOnly }: Props) {
  const { login, unlock } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    setLoading(true);
    try {
      if (requirePinOnly) {
        await unlock(pin);
      } else {
        await login({ email, password, pin: pin || undefined });
      }
    } catch (err) {
      setError(translateLoginError(err));
    } finally {
      setLoading(false);
    }
  };

  const formTitle = requirePinOnly ? 'Odemknutí stanoviště' : 'Přihlášení rozhodčího';
  const heroTitle = requirePinOnly ? 'Stanoviště' : 'Rozhodčí';
  const heroDescription = requirePinOnly
    ? 'Odemkni uložené stanoviště Setonova závodu pomocí PINu a pokračuj i bez připojení.'
    : 'Spravuj průběh Setonova závodu, výsledky a offline frontu přímo ze stanoviště.';

  return (
    <div className="auth-shell">
      <div className="auth-shell-content">
        <div className="auth-layout">
          <div className="auth-hero">
            <div className="auth-hero-logo">
              <img src={zelenaLigaLogo} alt="Logo Setonův závod" />
            </div>
            <div className="auth-hero-copy">
              <span className="auth-hero-eyebrow">Setonův závod</span>
              <h1>{heroTitle}</h1>
              <p>{heroDescription}</p>
            </div>
            <ul className="auth-hero-list">
              <li>Bezpečné přihlášení pro rozhodčí</li>
              <li>Offline režim se synchronizací fronty</li>
              <li>Rychlý export výsledků do XLSX</li>
            </ul>
          </div>

          <form className="auth-card" onSubmit={handleSubmit}>
            <h2>{formTitle}</h2>
            {requirePinOnly ? (
              <p className="auth-description">Zadej PIN pro odemknutí uloženého stanoviště.</p>
            ) : (
              <p className="auth-description">Přihlašovací údaje získáš od hlavního rozhodčího.</p>
            )}

            {!requirePinOnly ? (
              <label className="auth-field">
                <span>E-mail</span>
                <input
                  type="email"
                  inputMode="email"
                  autoComplete="username"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                />
              </label>
            ) : null}

            {!requirePinOnly ? (
              <label className="auth-field">
                <span>Heslo</span>
                <input
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                />
              </label>
            ) : null}

            <label className="auth-field">
              <span>{requirePinOnly ? 'PIN' : 'PIN (volitelné)'}</span>
              <input
                type="password"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                value={pin}
                onChange={(event) => setPin(event.target.value.replace(/[^0-9]/g, ''))}
                required={requirePinOnly}
              />
            </label>

            {error ? <p className="auth-error" role="alert">{error}</p> : null}

            <button type="submit" disabled={loading} className="auth-primary">
              {loading ? 'Pracuji…' : requirePinOnly ? 'Odemknout' : 'Přihlásit'}
            </button>
          </form>
        </div>
      </div>
      <AppFooter className="auth-footer" />
    </div>
  );
}
