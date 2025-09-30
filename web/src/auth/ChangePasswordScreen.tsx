import { FormEvent, useEffect, useRef, useState } from 'react';
import { changePasswordRequest } from './api';
import { useAuth } from './context';

interface Props {
  email: string;
  judgeId?: string;
  pendingPin?: string;
}

export default function ChangePasswordScreen({ email, judgeId, pendingPin }: Props) {
  const { login, logout } = useAuth();
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const isMountedRef = useRef(true);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!newPassword || !confirmPassword) {
      setError('Vyplň prosím nové heslo.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Hesla se neshodují.');
      return;
    }

    setError('');
    setLoading(true);

    try {
      await changePasswordRequest({
        email,
        id: judgeId,
        newPassword,
      });
      await login({ email, password: newPassword, pin: pendingPin });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return;
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
      }
    }
  };

  return (
    <div className="auth-shell">
      <form className="auth-card" onSubmit={handleSubmit}>
        <h1>Změna hesla</h1>
        <p className="auth-description">
          Účet <strong>{email}</strong> vyžaduje nastavení nového hesla.
        </p>

        <label className="auth-field">
          <span>Nové heslo</span>
          <input
            type="password"
            autoComplete="new-password"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            required
          />
        </label>

        <label className="auth-field">
          <span>Potvrzení hesla</span>
          <input
            type="password"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            required
          />
        </label>

        {error ? <p className="auth-error">{error}</p> : null}

        <button type="submit" className="auth-primary" disabled={loading}>
          {loading ? 'Ukládám…' : 'Nastavit heslo'}
        </button>
        <button
          type="button"
          className="auth-secondary"
          onClick={() => {
            void logout();
          }}
          disabled={loading}
        >
          Zpět na přihlášení
        </button>
      </form>
    </div>
  );
}
