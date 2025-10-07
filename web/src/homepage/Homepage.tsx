import './Homepage.css';
import logo from '../assets/znak_SPTO_transparent.png';
import pionyrLogo from '../assets/pionyr1_vert_rgb.png';

interface EventLink {
  slug: string;
  name: string;
  description: string;
  href: string;
  status: 'available' | 'coming-soon';
}

const EVENTS: EventLink[] = [
  {
    slug: 'setonuv-zavod',
    name: 'Setonův závod',
    description: 'Stanoviště, výsledky a kompletní servis pro celostátní soutěž SPTO vedenou vedoucími pro vedoucí.',
    href: '/setonuv-zavod',
    status: 'available',
  },
  {
    slug: 'draci-smycka',
    name: 'Dračí smyčka',
    description: 'Soutěž jednotlivců ve vázání uzlů. Nové ročníky připravujeme na stejném digitálním zázemí.',
    href: '/draci-smycka',
    status: 'coming-soon',
  },
];

function Homepage() {
  return (
    <div className="homepage-shell">
      <header className="homepage-hero">
        <a
          className="homepage-hero-logo"
          href="https://zelenaliga.cz"
          target="_blank"
          rel="noreferrer"
        >
          <img src={logo} alt="Logo Zelená liga" />
          <span className="homepage-logo-caption">SPTO Brno</span>
        </a>
        <div className="homepage-hero-copy">
          <p className="homepage-eyebrow">Zelená liga</p>
          <span className="homepage-eyebrow-accent" aria-hidden="true" />
          <h1>Digitální podpora soutěží SPTO</h1>
          <p className="homepage-subtitle">
            Projekt <a href="https://jihomoravsky.pionyr.cz/pto/" target="_blank" rel="noreferrer">Sdružení pionýrských turistických oddílů Brno</a>
          </p>
          <p className="homepage-lead">
            Jako vedoucí pro vedoucí zajišťujeme techniku, aplikace a výsledkový servis pro soutěže se
            skutečnou táborovou atmosférou.
          </p>
        </div>
      </header>

      <main className="homepage-main" aria-labelledby="homepage-events-heading">
        <div className="homepage-section-header">
          <h2 id="homepage-events-heading">Soutěže v naší péči</h2>
          <span className="homepage-section-accent" aria-hidden="true" />
          <p>Vyber si soutěž a přejdi na přihlášení stanovišť, výsledkovou tabuli nebo další informace.</p>
        </div>
        <div className="homepage-event-grid">
          {EVENTS.map((event) => (
            <a
              key={event.slug}
              className={`homepage-event-card ${event.status}`}
              data-active={event.status === 'available'}
              href={event.href}
              aria-describedby={`${event.slug}-description`}
            >
              <div className="homepage-event-card-body">
                <span className="homepage-event-label">Soutěž</span>
                <h3>{event.name}</h3>
                <p id={`${event.slug}-description`}>{event.description}</p>
              </div>
              <span className="homepage-event-cta">
                {event.status === 'available' ? 'Otevřít' : 'Připravujeme'}
              </span>
            </a>
          ))}
        </div>
      </main>

      <footer className="homepage-footer">
        <div className="homepage-footer-text">
          <p>&copy; 2025 Zelená liga SPTO</p>
          <p>Projekt SPTO Brno · Součást Pionýra</p>
          <p>Vytvořili 32. PTO Severka a Ševa</p>
        </div>
        <div className="homepage-footer-logos" aria-label="Logo SPTO Brno a Pionýr">
          <a href="https://jihomoravsky.pionyr.cz/pto/" target="_blank" rel="noreferrer" aria-label="SPTO Brno">
            <img src={logo} alt="SPTO Brno" />
          </a>
          <a href="https://pionyr.cz/" target="_blank" rel="noreferrer" aria-label="Pionýr">
            <img src={pionyrLogo} alt="Pionýr" />
          </a>
        </div>
      </footer>
    </div>
  );
}

interface EventPageProps {
  slug: string;
}

function EventPage({ slug }: EventPageProps) {
  const event = EVENTS.find((item) => item.slug === slug);

  if (!event) {
    return (
      <div className="homepage-shell">
        <main className="homepage-main homepage-single">
          <h1>Stránka nebyla nalezena</h1>
          <p>Omlouváme se, ale požadovaná stránka neexistuje. Zkuste se vrátit na domovskou stránku.</p>
          <a className="homepage-back-link" href="/">
            Zpět na Zelenou ligu
          </a>
        </main>
      </div>
    );
  }

  return (
    <div className="homepage-shell">
      <main className="homepage-main homepage-single" aria-labelledby="event-heading">
        <p className="homepage-eyebrow">Zelená liga</p>
        <h1 id="event-heading">{event.name}</h1>
        <p className="homepage-lead">{event.description}</p>
        <div className="homepage-card">
          <p>
            Elektronické rozhraní pro tuto soutěž právě připravujeme. Než spustíme plnou verzi,
            sleduj novinky na našem Facebooku nebo se ozvi na <a href="mailto:zavody@zelenaliga.cz">zavody@zelenaliga.cz</a>.
          </p>
        </div>
        <a className="homepage-back-link" href="/">
          Zpět na hlavní stránku
        </a>
      </main>
    </div>
  );
}

export default function ZelenaligaSite() {
  const path = window.location.pathname.replace(/\/$/, '') || '/' ;

  if (path === '/') {
    return <Homepage />;
  }

  const slugMatch = path.match(/^\/(.+)$/);
  const slug = slugMatch ? slugMatch[1] : null;

  if (slug) {
    return <EventPage slug={slug} />;
  }

  return <Homepage />;
}
