import { useEffect, useState } from 'react';
import '../styles/LoginPage.css';
import { useAuth } from './context';
import zelenaLigaLogo from '../assets/znak_SPTO_transparent.png';
import AppFooter from '../components/AppFooter';
import { supabase } from '../supabaseClient';
import {
  ADMIN_ROUTE_PREFIX,
  DESKOVKY_ROUTE_PREFIX,
  FORGOT_PASSWORD_ROUTE,
  ROUTE_PREFIX,
} from '../routing';
import { translateLoginError, type LoginErrorFeedback } from './loginErrors';

type LoginVariant = 'seton' | 'deskovky';

interface Props {
  requirePinOnly?: boolean;
  variant?: LoginVariant;
}

type LoginEventOption = {
  id: string;
  name: string;
};

const PREFERRED_EVENT_ID_STORAGE_KEY = 'auth:preferred-event-id';

export default function LoginScreen({ requirePinOnly, variant = 'seton' }: Props) {
  const { login, unlock } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pin, setPin] = useState('');
  const [events, setEvents] = useState<LoginEventOption[]>([]);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [eventsError, setEventsError] = useState<string | null>(null);
  const [selectedEventId, setSelectedEventId] = useState(() => {
    if (typeof window === 'undefined') {
      return '';
    }
    const stored = window.localStorage.getItem(PREFERRED_EVENT_ID_STORAGE_KEY);
    return typeof stored === 'string' ? stored.trim() : '';
  });
  const [error, setError] = useState<LoginErrorFeedback | null>(null);
  const [loading, setLoading] = useState(false);
  const [isBrowserOnline, setIsBrowserOnline] = useState(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true,
  );
  const isDeskovky = variant === 'deskovky';
  const showEventSelector = !requirePinOnly && !isDeskovky;

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

  useEffect(() => {
    if (!showEventSelector) {
      setEvents([]);
      setEventsError(null);
      setEventsLoading(false);
      return;
    }

    let cancelled = false;
    const loadEvents = async () => {
      setEventsLoading(true);
      setEventsError(null);
      try {
        const { data, error: fetchError } = await supabase
          .from('events_public')
          .select('id,name')
          .order('starts_at', { ascending: false, nullsFirst: false });

        if (cancelled) {
          return;
        }

        if (fetchError) {
          throw fetchError;
        }

        const nextEvents = Array.isArray(data)
          ? data
              .map((row) => {
                const id = typeof row.id === 'string' ? row.id.trim() : '';
                const name = typeof row.name === 'string' ? row.name.trim() : '';
                if (!id || !name) {
                  return null;
                }
                return { id, name } as LoginEventOption;
              })
              .filter((row): row is LoginEventOption => Boolean(row))
          : [];

        setEvents(nextEvents);
        setSelectedEventId((current) => {
          const fromQuery =
            typeof window !== 'undefined'
              ? new URLSearchParams(window.location.search).get('event')?.trim() ?? ''
              : '';
          const preferred = fromQuery || current;
          if (preferred && nextEvents.some((item) => item.id === preferred)) {
            return preferred;
          }
          return nextEvents[0]?.id ?? '';
        });
      } catch (err) {
        console.error('Failed to load login events', err);
        if (cancelled) {
          return;
        }
        setEvents([]);
        setEventsError('Nepodařilo se načíst seznam ročníků.');
      } finally {
        if (!cancelled) {
          setEventsLoading(false);
        }
      }
    };

    void loadEvents();

    return () => {
      cancelled = true;
    };
  }, [showEventSelector]);

  useEffect(() => {
    if (!showEventSelector || typeof window === 'undefined') {
      return;
    }
    const normalizedEventId = selectedEventId.trim();
    if (!normalizedEventId) {
      window.localStorage.removeItem(PREFERRED_EVENT_ID_STORAGE_KEY);
      return;
    }
    window.localStorage.setItem(PREFERRED_EVENT_ID_STORAGE_KEY, normalizedEventId);
  }, [selectedEventId, showEventSelector]);

  const hasEmail = email.trim().length > 0;
  const hasPassword = password.length > 0;
  const hasPin = pin.trim().length > 0;
  const isFormValid = requirePinOnly ? hasPin : hasEmail && hasPassword && hasPin;
  const submitDisabled = loading || !isFormValid;
  const submitLabel = requirePinOnly ? 'Odemknout' : 'Přihlásit';
  const loadingLabel = requirePinOnly ? 'Odemykám…' : 'Přihlašuji…';

  const formTitle = requirePinOnly
    ? isDeskovky
      ? 'Odemknutí účtu rozhodčího'
      : 'Odemknutí stanoviště'
    : isDeskovky
      ? 'Přihlášení rozhodčího'
      : 'Přihlášení rozhodčího';
  const heroEyebrow = isDeskovky ? 'Deskové hry - aplikace' : 'Setonův závod - aplikace';
  const heroTitle = heroEyebrow;
  const heroSubtitle = requirePinOnly
    ? isDeskovky
      ? 'Odemkni uložený účet rozhodčího Deskovek a pokračuj v turnaji.'
      : 'Odemkni uložené stanoviště aplikace Setonův závod a pokračuj i bez připojení.'
    : isDeskovky
      ? 'Zápis zápasů turnaje a průběžného pořadí kategorií.'
      : 'Záznam výsledků ze stanovišť závodu.';
  const heroItems = requirePinOnly
    ? isDeskovky
      ? [
          'Rychlé odemknutí pomocí PINu',
          'Bezpečný návrat do rozpracovaného zápisu',
          'Pokračování bez nového přihlášení',
        ]
      : [
          'Práce v offline režimu',
          'Bezpečné odemknutí pomocí PINu',
          'Automatická synchronizace výsledků',
        ]
    : isDeskovky
      ? [
          'Přihlášení rozhodčích turnaje',
          'Skenování QR visaček hráčů',
          'Průběžné pořadí podle her a kategorií',
        ]
      : [
          'Přihlášení rozhodčích stanovišť',
          'Offline režim se synchronizací',
          'Export výsledků do tabulek',
        ];
  const descriptionText = requirePinOnly
    ? isDeskovky
      ? 'Zadej PIN pro odemknutí uloženého účtu rozhodčího.'
      : 'Zadej PIN pro odemknutí uloženého stanoviště.'
    : isDeskovky
      ? 'Přihlašovací údaje získáš od hlavního rozhodčího turnaje.'
      : 'Přihlašovací údaje získáš od hlavního rozhodčího.';
  const descriptionId = requirePinOnly ? 'login-description-pin' : 'login-description';
  const showResetHint =
    !requirePinOnly && typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('reset') === '1';
  const showAdminLoginShortcut = !isDeskovky;
  const adminHref = ADMIN_ROUTE_PREFIX;
  const adminLabel = 'Přihlášení pro admina závodu';
  const forgotNext = isDeskovky ? DESKOVKY_ROUTE_PREFIX : ROUTE_PREFIX;
  const forgotPasswordHref = `${FORGOT_PASSWORD_ROUTE}?next=${encodeURIComponent(forgotNext)}`;

  const emailFieldId = 'login-email';
  const passwordFieldId = 'login-password';
  const pinFieldId = 'login-pin';
  const pinLabel = requirePinOnly ? 'PIN' : 'PIN (povinný)';
  const pinHintId = `${pinFieldId}-hint`;
  const pinHintText = requirePinOnly
    ? 'PIN slouží k odemknutí uloženého účtu na tomto zařízení.'
    : 'PIN je povinný a slouží k odemknutí uložené relace na tomto zařízení.';

  const emailError = error?.field === 'email' ? error.message : null;
  const passwordError = error?.field === 'password' ? error.message : null;
  const pinError = error?.field === 'pin' ? error.message : null;
  const showOfflineNotice = !isBrowserOnline;

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!isFormValid) {
      return;
    }

    const trimmedEmail = email.trim();
    const trimmedPin = pin.trim();

    setError(null);
    setLoading(true);
    try {
      if (requirePinOnly) {
        await unlock(trimmedPin);
      } else {
        const normalizedEventId = selectedEventId.trim();
        const eventId = showEventSelector && events.some((item) => item.id === normalizedEventId)
          ? normalizedEventId
          : undefined;
        await login({
          email: trimmedEmail,
          password,
          pin: trimmedPin,
          eventId,
        });
      }
    } catch (err) {
      setError(translateLoginError(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={`login-page login-page--referee ${isDeskovky ? 'login-page--deskovky' : ''}`.trim()}>
      <div className="login-main">
        <div className="login-layout">
          <section className={`login-hero ${isDeskovky ? 'login-hero--deskovky' : ''}`.trim()} aria-label="Informace pro rozhodčí">
            <div className="login-hero-brand">
              <img src={zelenaLigaLogo} alt="Logo SPTO Brno" className="login-hero-logo" />
              <div className="login-hero-brand-text">
                <span className="login-hero-brand-name">SPTO BRNO</span>
                <span className="login-hero-brand-caption">Součást Pionýra</span>
              </div>
            </div>
            <div className="login-hero-copy">
              <span className="login-hero-eyebrow">{heroEyebrow}</span>
              <h1>{heroTitle}</h1>
              <p>{heroSubtitle}</p>
            </div>
            <ul className="login-hero-list">
              {heroItems.map((item) => (
                <li key={item} className="login-hero-list-item">
                  {item}
                </li>
              ))}
            </ul>
            {showAdminLoginShortcut ? (
              <a className="login-hero-button" href={adminHref} target="_blank" rel="noreferrer">
                <span>{adminLabel}</span>
                <span className="login-hero-button-icon" aria-hidden="true">
                  →
                </span>
              </a>
            ) : null}
          </section>

          <form
            className="login-card"
            onSubmit={handleSubmit}
            aria-describedby={descriptionId}
            noValidate
          >
            {showOfflineNotice ? (
              <div className="login-offline" role="status">
                <span className="login-offline-indicator" aria-hidden="true" />
                Jste offline – přihlášení se uloží a odešle po připojení.
              </div>
            ) : null}
            <h2>{formTitle}</h2>
            <p id={descriptionId} className="login-card-description">
              {descriptionText}
            </p>
            {showResetHint ? (
              <div className="login-alert login-alert--info" role="status">
                <span className="login-alert-icon" aria-hidden="true">i</span>
                <span>Použij dočasné heslo z e-mailu. Po přihlášení nastavíš nové heslo.</span>
              </div>
            ) : null}
            {error ? (
              <div className="login-alert login-alert--error" role="alert">
                <span className="login-alert-icon" aria-hidden="true">!</span>
                <span>{error.message}</span>
              </div>
            ) : null}

            {!requirePinOnly ? (
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
            ) : null}

            {showEventSelector ? (
              <div className="login-field-group">
                <label className="login-field" htmlFor="login-event">
                  <span>Ročník závodu</span>
                  <select
                    id="login-event"
                    value={selectedEventId}
                    onChange={(event) => setSelectedEventId(event.target.value)}
                    disabled={eventsLoading || events.length === 0}
                  >
                    {events.map((eventOption) => (
                      <option key={eventOption.id} value={eventOption.id}>
                        {eventOption.name}
                      </option>
                    ))}
                  </select>
                </label>
                {eventsLoading ? (
                  <p className="login-field-hint">Načítám ročníky…</p>
                ) : null}
                {!eventsLoading && eventsError ? (
                  <p className="login-field-error">{eventsError}</p>
                ) : null}
                {!eventsLoading && !eventsError && events.length === 0 ? (
                  <p className="login-field-error">Není dostupný žádný ročník.</p>
                ) : null}
              </div>
            ) : null}

            {!requirePinOnly ? (
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
                      setError((current) =>
                        current && current.field === 'password' ? null : current,
                      );
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
            ) : null}

            <div className="login-field-group">
              <label className="login-field" htmlFor={pinFieldId}>
                <span>{pinLabel}</span>
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
                  required
                  aria-invalid={pinError ? 'true' : 'false'}
                  aria-describedby={pinError ? `${pinHintId} ${pinFieldId}-error` : pinHintId}
                />
              </label>
              <p id={pinHintId} className="login-field-hint">
                {pinHintText}
              </p>
              {pinError ? (
                <p id={`${pinFieldId}-error`} className="login-field-error">
                  {pinError}
                </p>
              ) : null}
            </div>

            <button type="submit" disabled={submitDisabled} className="login-primary">
              {loading ? loadingLabel : submitLabel}
            </button>
            <div className="login-links">
              <a className="login-link" href={forgotPasswordHref}>
                Zapomenuté heslo
              </a>
              <a className="login-link login-link--muted" href="/">
                Zpět na Zelenou ligu
              </a>
            </div>
          </form>
        </div>
      </div>
      <AppFooter variant="minimal" className="login-footer" />
    </div>
  );
}
