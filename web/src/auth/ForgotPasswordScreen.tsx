import { FormEvent, useCallback, useState } from 'react';
import '../styles/LoginPage.css';
import '../styles/ForgotPasswordPage.css';
import AppFooter from '../components/AppFooter';
import zelenaLigaLogo from '../assets/znak_SPTO_transparent.png';
import { ROUTE_PREFIX } from '../routing';
import { requestPasswordReset } from './api';

export default function ForgotPasswordScreen() {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading'>('idle');
  const [feedback, setFeedback] = useState<'idle' | 'success' | 'error'>('idle');
  const [fieldError, setFieldError] = useState('');

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (status === 'loading') return;

    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setFieldError('Zadej prosím e-mailovou adresu.');
      return;
    }

    setStatus('loading');
    setFieldError('');
    setFeedback('idle');

    try {
      await requestPasswordReset(trimmedEmail);
      setFeedback('success');
    } catch (err) {
      console.error('Password reset request failed', err);
      setFeedback('error');
    }
    setStatus('idle');
  };

  const isLoading = status === 'loading';
  const showSuccess = feedback === 'success';
  const showError = feedback === 'error';

  const handleBackToLogin = useCallback(() => {
    window.location.assign(ROUTE_PREFIX);
  }, []);

  return (
    <div className="login-page login-page--forgot">
      <main className="login-main">
        <div className="login-layout">
          <section className="login-hero login-hero--forgot" aria-label="Informace k obnově hesla">
            <div className="login-hero-brand login-hero-brand--forgot">
              <img src={zelenaLigaLogo} alt="Logo SPTO Brno" className="login-hero-logo" />
              <div className="login-hero-brand-text">
                <span className="login-hero-brand-name">SPTO Brno</span>
                <span className="login-hero-brand-caption">Součást Pionýra</span>
              </div>
            </div>
            <div className="login-hero-copy login-hero-copy--forgot">
              <h1>Obnova hesla</h1>
              <p>Získáš odkaz pro vytvoření nového hesla na e-mail, který máš u svého účtu.</p>
            </div>
            <ul className="login-hero-list login-hero-list--checks">
              <li className="login-hero-list-item">Bezpečný proces obnovy účtu</li>
              <li className="login-hero-list-item">Odkaz platný 15 minut</li>
              <li className="login-hero-list-item">Správa účtu v Zelené lize</li>
            </ul>
            <button type="button" className="login-hero-back-button" onClick={handleBackToLogin}>
              ← Zpět na přihlášení
            </button>
          </section>

          <form className="login-card login-form" onSubmit={handleSubmit} noValidate>
            <header className="login-form-header">
              <h2>Přihlášení k účtu</h2>
              <p className="login-card-description">
                Zadej e-mail, na který ti pošleme odkaz pro nastavení nového hesla.
              </p>
            </header>

            {showSuccess ? (
              <div className="login-feedback login-feedback--success" role="status">
                <span className="login-feedback-icon" aria-hidden="true" />
                <span>Odkaz byl odeslán. Zkontroluj e-mail.</span>
              </div>
            ) : null}

            {showError ? (
              <div className="login-feedback login-feedback--error" role="alert">
                <span className="login-feedback-icon" aria-hidden="true" />
                <span>Nepodařilo se odeslat odkaz. Zkus to znovu.</span>
              </div>
            ) : null}

            <div className="login-field-group">
              <label className="login-field" htmlFor="forgot-password-email">
                <span>E-mail</span>
                <input
                  id="forgot-password-email"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  value={email}
                  onChange={(event) => {
                    setEmail(event.target.value);
                    setFieldError('');
                    if (feedback !== 'idle') {
                      setFeedback('idle');
                    }
                  }}
                  placeholder="jan.novak@…"
                  required
                  aria-invalid={fieldError ? 'true' : 'false'}
                  aria-describedby={fieldError ? 'forgot-password-email-error' : undefined}
                />
              </label>
              {fieldError ? (
                <p id="forgot-password-email-error" className="login-field-error">
                  {fieldError}
                </p>
              ) : null}
            </div>

            <button type="submit" className="login-primary" disabled={isLoading}>
              {isLoading ? 'Odesílám…' : 'Odeslat odkaz pro obnovu'}
            </button>

            <div className="login-form-footer">
              <button
                type="button"
                className="login-form-back-button"
                onClick={handleBackToLogin}
              >
                ← Zpět na přihlášení
              </button>
            </div>
          </form>
        </div>
      </main>
      <AppFooter variant="minimal" className="login-footer" />
    </div>
  );
}
