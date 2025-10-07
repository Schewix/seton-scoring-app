import './AppFooter.css';
import spLogo from '../assets/znak_SPTO_transparent.png';
import pionyrLogo from '../assets/pionyr1_vert_rgb.png';

interface AppFooterProps {
  className?: string;
}

export default function AppFooter({ className }: AppFooterProps) {
  const classes = ['app-footer'];

  if (className) {
    classes.push(className);
  }

  return (
    <footer className={classes.join(' ')}>
      <div className="app-footer-content">
        <p>© 2025 Zelená liga SPTO · Projekt SPTO Brno · Součást Pionýra</p>
        <p>Vytvořili 32. PTO Severka a Ševa</p>
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
