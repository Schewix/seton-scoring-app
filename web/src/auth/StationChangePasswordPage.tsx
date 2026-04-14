import { FormEvent, useMemo, useState } from 'react';
import AppFooter from '../components/AppFooter';
import { changeOwnPasswordRequest } from './api';

interface StationChangePasswordPageProps {
  accessToken: string;
  onBack: () => void;
}

function toFriendlyError(message: string) {
  const normalized = message.trim().toLowerCase();
  if (normalized.includes('missing new password')) {
    return 'Chybí nové heslo.';
  }
  if (normalized.includes('missing current password')) {
    return 'Zadej aktuální heslo.';
  }
  if (normalized.includes('current password is incorrect')) {
    return 'Aktuální heslo nesouhlasí.';
  }
  if (normalized.includes('missing user identifier')) {
    return 'Nepodařilo se určit účet rozhodčího. Přihlas se prosím znovu.';
  }
  if (normalized.includes('invalid access token')) {
    return 'Přihlášení vypršelo. Přihlas se prosím znovu.';
  }
  if (normalized.includes('cannot change another user password')) {
    return 'Nelze změnit heslo jiného účtu.';
  }
  return message || 'Heslo se nepodařilo změnit.';
}

function getPasswordStrength(password: string) {
  if (!password) {
    return { label: 'nezadané', hint: 'Použij alespoň 8 znaků, číslo a speciální znak.' };
  }

  let score = 0;
  if (password.length >= 8) score += 1;
  if (password.length >= 12) score += 1;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score += 1;
  if (/\d/.test(password)) score += 1;
  if (/[^A-Za-z0-9]/.test(password)) score += 1;

  if (score <= 2) {
    return { label: 'slabé', hint: 'Přidej délku, čísla a speciální znaky.' };
  }
  if (score <= 4) {
    return { label: 'střední', hint: 'Zvaž delší heslo s kombinací více typů znaků.' };
  }
  return { label: 'silné', hint: 'Heslo má dobrou délku i variabilitu znaků.' };
}

export default function StationChangePasswordPage({ accessToken, onBack }: StationChangePasswordPageProps) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPasswords, setShowPasswords] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [saving, setSaving] = useState(false);

  const passwordStrength = useMemo(() => getPasswordStrength(newPassword), [newPassword]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!currentPassword || !newPassword || !confirmPassword) {
      setSuccess('');
      setError('Vyplň všechna pole.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setSuccess('');
      setError('Nové heslo a potvrzení hesla se neshodují.');
      return;
    }
    if (!accessToken) {
      setSuccess('');
      setError('Chybí přihlášení. Přihlas se prosím znovu.');
      return;
    }

    setSaving(true);
    setError('');
    setSuccess('');
    try {
      await changeOwnPasswordRequest({
        currentPassword,
        newPassword,
        accessToken,
      });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setSuccess('Heslo bylo změněno.');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Heslo se nepodařilo změnit.';
      setError(toFriendlyError(message));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="app-shell">
      <header className="hero">
        <div className="hero-inner">
          <div className="hero-brand">
            <div>
              <h1>Změna hesla</h1>
              <p>Aktualizuj přístupové heslo pro tento účet rozhodčího.</p>
            </div>
          </div>
        </div>
      </header>
      <main className="content">
        <section className="card form-card change-password-card">
          <header className="card-header">
            <div>
              <h2>Změnit heslo</h2>
              <p className="card-subtitle">Pro potvrzení zadej aktuální heslo a nové heslo dvakrát.</p>
            </div>
            <button type="button" className="ghost" onClick={onBack} disabled={saving}>
              Zpět na stanoviště
            </button>
          </header>

          <form className="change-password-form" onSubmit={handleSubmit} noValidate>
            <label htmlFor="station-password-current">
              Aktuální heslo
              <input
                id="station-password-current"
                type={showPasswords ? 'text' : 'password'}
                autoComplete="current-password"
                value={currentPassword}
                onChange={(event) => {
                  setCurrentPassword(event.target.value);
                  setError('');
                  setSuccess('');
                }}
                required
              />
            </label>

            <label htmlFor="station-password-new">
              Nové heslo
              <input
                id="station-password-new"
                type={showPasswords ? 'text' : 'password'}
                autoComplete="new-password"
                value={newPassword}
                onChange={(event) => {
                  setNewPassword(event.target.value);
                  setError('');
                  setSuccess('');
                }}
                required
              />
            </label>

            <label htmlFor="station-password-confirm">
              Potvrzení nového hesla
              <input
                id="station-password-confirm"
                type={showPasswords ? 'text' : 'password'}
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(event) => {
                  setConfirmPassword(event.target.value);
                  setError('');
                  setSuccess('');
                }}
                required
              />
            </label>

            <label className="change-password-toggle">
              <input
                type="checkbox"
                checked={showPasswords}
                onChange={(event) => setShowPasswords(event.target.checked)}
              />
              Zobrazit hesla
            </label>

            <p className="card-hint">
              Síla nového hesla: <strong>{passwordStrength.label}</strong>. {passwordStrength.hint}
            </p>

            {error ? <p className="error-text">{error}</p> : null}
            {success ? <p className="success-text">{success}</p> : null}

            <div className="change-password-actions">
              <button type="submit" className="primary" disabled={saving}>
                {saving ? 'Ukládám…' : 'Uložit nové heslo'}
              </button>
              <button type="button" className="ghost" onClick={onBack} disabled={saving}>
                Zrušit
              </button>
            </div>
          </form>
        </section>
      </main>
      <AppFooter />
    </div>
  );
}
