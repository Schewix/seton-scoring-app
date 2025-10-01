import { useState } from 'react';
import { useAuth } from './context';
import zelenaLigaLogo from '../assets/znak_SPTO_transparent.png';

interface Props {
  requirePinOnly?: boolean;
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
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const formTitle = requirePinOnly ? 'Odemknutí stanoviště' : 'Přihlášení rozhodčího';
  const heroTitle = requirePinOnly ? 'Stanoviště' : 'Rozhodčí';
  const heroDescription = requirePinOnly
    ? 'Odemkni uložené stanoviště pomocí PINu a pokračuj i bez připojení.'
    : 'Spravuj průběh závodu, výsledky a offline frontu přímo ze stanoviště.';

  return (
    <div className="auth-shell">
      <div className="auth-layout">
        <div className="auth-hero">
          <div className="auth-hero-logo">
            <img src={zelenaLigaLogo} alt="Logo Zelená liga" />
          </div>
          <div className="auth-hero-copy">
            <span className="auth-hero-eyebrow">Zelená liga</span>
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

          {error ? <p className="auth-error">{error}</p> : null}

          <button type="submit" disabled={loading} className="auth-primary">
            {loading ? 'Pracuji…' : requirePinOnly ? 'Odemknout' : 'Přihlásit'}
          </button>
        </form>
      </div>
    </div>
  );
}
