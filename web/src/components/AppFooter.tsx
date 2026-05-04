import './AppFooter.css';
import { useRef } from 'react';
import spLogo from '../assets/znak_SPTO_transparent.png';
import pionyrLogo from '../assets/pionyr1_vert_rgb.png';

interface AppFooterProps {
  className?: string;
  variant?: 'minimal' | 'dark';
  onSecretTrigger?: () => void;
}

const FOOTER_SECRET_CLICK_COUNT = 5;
const FOOTER_SECRET_CLICK_WINDOW_MS = 2000;

export default function AppFooter({ className, variant = 'minimal', onSecretTrigger }: AppFooterProps) {
  const classes = ['app-footer', `app-footer--${variant}`];
  const secretTapTimestampsRef = useRef<number[]>([]);

  if (className) {
    classes.push(className);
  }

  const handleSecretClick = () => {
    if (!onSecretTrigger) {
      return;
    }
    const now = Date.now();
    const recent = secretTapTimestampsRef.current.filter(
      (timestamp) => now - timestamp <= FOOTER_SECRET_CLICK_WINDOW_MS,
    );
    recent.push(now);
    secretTapTimestampsRef.current = recent;
    if (recent.length >= FOOTER_SECRET_CLICK_COUNT) {
      secretTapTimestampsRef.current = [];
      onSecretTrigger();
    }
  };

  return (
    <footer className={classes.join(' ')}>
      <div className="app-footer-content">
        <p>
          © 2025{' '}
          <span
            className={`app-footer-secret-trigger${onSecretTrigger ? ' is-enabled' : ''}`}
            onClick={handleSecretClick}
          >
            Zelená liga
          </span>{' '}
          SPTO · Projekt SPTO Brno · Součást Pionýra
        </p>
        <p>
          Vytvořili{' '}
          <a href="https://severka.org" target="_blank" rel="noreferrer">
            32. PTO Severka
          </a>{' '}
          a{' '}
          <a href="https://portfolio-two-lovat-xnqdw7pcee.vercel.app/" target="_blank" rel="noreferrer">
            Ševa
          </a>
        </p>
      </div>
      <div className="app-footer-logos" aria-label="Logo SPTO Brno a Pionýr">
        <a href="https://jihomoravsky.pionyr.cz/pto/" target="_blank" rel="noreferrer" aria-label="SPTO Brno">
          <img src={spLogo} alt="SPTO Brno" />
        </a>
        <a href="https://pionyr.cz/" target="_blank" rel="noreferrer" aria-label="Pionýr">
          <img src={pionyrLogo} alt="Pionýr" />
        </a>
      </div>
    </footer>
  );
}
