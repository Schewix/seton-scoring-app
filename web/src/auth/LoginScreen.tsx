import { useState } from 'react';
import { useAuth } from './context';

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

  return (
    <div className="auth-shell">
      <form className="auth-card" onSubmit={handleSubmit}>
        <h1>{requirePinOnly ? 'Odemknutí stanoviště' : 'Přihlášení rozhodčího'}</h1>
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
  );
}
