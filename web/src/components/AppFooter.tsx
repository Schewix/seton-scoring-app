import './AppFooter.css';
import spLogo from '../assets/znak_SPTO_transparent.png';
import pionyrLogo from '../assets/pionyr1_vert_rgb.png';

interface AppFooterProps {
  className?: string;
  variant?: 'minimal' | 'dark';
}

export default function AppFooter({ className, variant = 'minimal' }: AppFooterProps) {
  const classes = ['app-footer', `app-footer--${variant}`];

  if (className) {
    classes.push(className);
  }

  return (
    <footer className={classes.join(' ')}>
      <div className="app-footer-content">
        <p>© 2025 Zelená liga SPTO · Projekt SPTO Brno · Součást Pionýra</p>
        <p>
          Vytvořili{' '}
          <a href="https://severka.org" target="_blank" rel="noreferrer">
            32. PTO Severka
          </a>{' '}
          a Ševa
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
