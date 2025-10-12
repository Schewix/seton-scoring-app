import { FormEvent, useState } from 'react';
import AppFooter from '../components/AppFooter';
import zelenaLigaLogo from '../assets/znak_SPTO_transparent.png';
import { ROUTE_PREFIX } from '../routing';
import { requestPasswordReset } from './api';

export default function ForgotPasswordScreen() {
  const [email, setEmail] = useState('');
  const [submittedEmail, setSubmittedEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'success'>('idle');
  const [error, setError] = useState('');

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (status === 'loading') return;

    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setError('Zadej prosím e-mailovou adresu.');
      return;
    }

    setStatus('loading');
    setError('');

    try {
      await requestPasswordReset(trimmedEmail);
      setSubmittedEmail(trimmedEmail);
      setStatus('success');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus('idle');
    }
  };

  const isLoading = status === 'loading';
  const isSuccess = status === 'success';

  return (
    <div className="auth-shell">
      <div className="auth-shell-content">
        <div className="auth-layout">
          <section className="auth-hero" aria-label="Informace k obnově hesla">
            <div className="auth-hero-brand">
              <a className="auth-hero-logo" href="https://zelenaliga.cz" target="_blank" rel="noreferrer">
                <img src={zelenaLigaLogo} alt="Logo SPTO Brno" />
              </a>
              <span className="auth-hero-caption">SPTO Brno</span>
            </div>
            <div className="auth-hero-copy">
              <span className="auth-hero-eyebrow">Setonův závod</span>
              <h1>Obnova hesla</h1>
              <p>Získáš odkaz pro vytvoření nového hesla na e-mail, který máš u svého účtu.</p>
            </div>
            <ul className="auth-hero-list">
              <li>Bezpečný proces obnovy účtu</li>
              <li>Odkaz platný 15 minut</li>
              <li>Správa účtu v Zelené lize</li>
            </ul>
            <a className="auth-hero-secondary" href={ROUTE_PREFIX}>
              ← Zpět na přihlášení
            </a>
          </section>

          {isSuccess ? (
            <div className="auth-card auth-status-card" role="status">
              <div className="auth-status-header">
                <span className="auth-status-icon" aria-hidden="true">
                  ✓
                </span>
                <div className="auth-status-text">
                  <h2>E-mail odeslán</h2>
                  <p className="auth-description">
                    Zkontroluj svou schránku a klikni na odkaz pro vytvoření nového hesla.
                  </p>
                  <p className="auth-status-meta">
                    Odeslali jsme ho na adresu <strong>{submittedEmail}</strong>.
                  </p>
                </div>
              </div>
              <div className="auth-status-actions">
                <button
                  type="button"
                  className="auth-status-repeat"
                  onClick={() => {
                    setStatus('idle');
                    setError('');
                    setEmail(submittedEmail);
                  }}
                >
                  Poslat znovu
                </button>
                <a className="auth-link auth-status-link" href={ROUTE_PREFIX}>
                  ← Zpět na přihlášení
                </a>
              </div>
            </div>
          ) : (
            <form className="auth-card" onSubmit={handleSubmit} noValidate>
              <h2>Obnova hesla</h2>
              <p className="auth-description">
                Zadej svůj e-mail. Pošleme ti odkaz pro nastavení nového hesla.
              </p>

              <div className="auth-field-group">
                <label className="auth-field" htmlFor="forgot-password-email">
                  <span>E-mail</span>
                  <input
                    id="forgot-password-email"
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    value={email}
                    onChange={(event) => {
                      setEmail(event.target.value);
                      setError('');
                    }}
                    placeholder="jan.novak@…"
                    required
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

              <button type="submit" className="auth-primary" disabled={isLoading}>
                {isLoading ? 'Odesílám…' : 'Odeslat odkaz pro obnovu'}
              </button>
              <div className="auth-card-footer">
                <a className="auth-link" href={ROUTE_PREFIX}>
                  ← Zpět na přihlášení
                </a>
              </div>
            </form>
          )}
        </div>
      </div>
      <AppFooter variant="minimal" className="auth-footer" />
    </div>
  );
}
