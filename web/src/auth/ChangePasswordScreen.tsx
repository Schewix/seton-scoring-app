import { FormEvent, useEffect, useRef, useState } from 'react';
import { changePasswordRequest } from './api';
import { useAuth } from './context';
import zelenaLigaLogo from '../assets/znak_SPTO_transparent.png';
import AppFooter from '../components/AppFooter';

interface Props {
  email: string;
  judgeId?: string;
  pendingPin?: string;
  variant?: 'seton' | 'deskovky';
}

export default function ChangePasswordScreen({ email, judgeId, pendingPin, variant = 'seton' }: Props) {
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

  const isDeskovky = variant === 'deskovky';
  const heroEyebrow = isDeskovky ? 'Deskové hry - aplikace' : 'Setonův závod - aplikace';
  const heroSubtitle = isDeskovky
    ? 'Dokonči změnu hesla a vrať se zpět k zadávání zápasů turnaje.'
    : 'Dokonči změnu hesla a vrať se zpět ke správě stanoviště.';
  const heroItems = isDeskovky
    ? [
        'Bezpečné přihlášení rozhodčích turnaje',
        'Okamžitý návrat do modulu Deskovky',
        'Podpora PINu pro sdílené zařízení',
      ]
    : [
        'Šifrované uložení přístupových údajů',
        'Okamžité přihlášení po úspěšné změně',
        'Podpora PINu pro zamčené stanoviště',
      ];

  return (
    <div className={`auth-shell ${isDeskovky ? 'auth-shell--deskovky' : ''}`.trim()}>
      <div className="auth-shell-content">
        <div className="auth-layout">
          <div className={`auth-hero ${isDeskovky ? 'auth-hero--deskovky' : ''}`.trim()}>
            <div className="auth-hero-brand">
              <a
                className="auth-hero-logo"
                href="https://zelenaliga.cz"
                target="_blank"
                rel="noreferrer"
              >
                <img src={zelenaLigaLogo} alt="Logo SPTO Brno" />
              </a>
              <span className="auth-hero-caption">SPTO Brno</span>
            </div>
            <div className="auth-hero-copy">
              <span className="auth-hero-eyebrow">{heroEyebrow}</span>
              <h1>Obnova přístupu</h1>
              <p>{heroSubtitle}</p>
            </div>
            <ul className="auth-hero-list">
              {heroItems.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>

          <form className="auth-card" onSubmit={handleSubmit}>
            <div className="auth-card-header">
              <h2>Změna hesla</h2>
              <p className="auth-description">
                {heroSubtitle}
              </p>
              <p className="auth-caption">
                Účet <strong>{email}</strong> vyžaduje nastavení nového hesla.
              </p>
            </div>

            <div className="auth-field-group">
              <label className="auth-field" htmlFor="change-password-new">
                <span>Nové heslo</span>
                <input
                  id="change-password-new"
                  type="password"
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(event) => {
                    setNewPassword(event.target.value);
                    setError('');
                  }}
                  required
                  aria-invalid={Boolean(error) ? 'true' : 'false'}
                />
              </label>
            </div>

            <div className="auth-field-group">
              <label className="auth-field" htmlFor="change-password-confirm">
                <span>Potvrzení hesla</span>
                <input
                  id="change-password-confirm"
                  type="password"
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(event) => {
                    setConfirmPassword(event.target.value);
                    setError('');
                  }}
                  required
                  aria-invalid={Boolean(error) ? 'true' : 'false'}
                />
              </label>
            </div>

            {error ? (
              <div className="auth-alert auth-alert--error" role="alert">
                <span className="auth-alert-icon" aria-hidden="true">
                  !
                </span>
                <span>{error}</span>
              </div>
            ) : null}

            <div className="auth-card-actions">
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
            </div>
          </form>
        </div>
      </div>
      <AppFooter variant="minimal" className="auth-footer" />
    </div>
  );
}
