import './Homepage.css';
import logo from '../assets/znak_SPTO_transparent.png';

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
        <div className="homepage-hero-logo" aria-hidden="true">
          <img src={logo} alt="Logo Zelená liga" />
        </div>
        <div className="homepage-hero-copy">
          <p className="homepage-eyebrow">Zelená liga</p>
          <h1>Digitální podpora soutěží SPTO</h1>
          <p className="homepage-lead">
            Jako vedoucí pro vedoucí zajišťujeme techniku, aplikace a výsledkový servis pro soutěže se
            skutečnou táborovou atmosférou.
          </p>
        </div>
      </header>

      <main className="homepage-main" aria-labelledby="homepage-events-heading">
        <div className="homepage-section-header">
          <h2 id="homepage-events-heading">Soutěže v naší péči</h2>
          <p>Vyber si soutěž a přejdi na přihlášení stanovišť, výsledkovou tabuli nebo další informace.</p>
        </div>
        <div className="homepage-event-grid">
          {EVENTS.map((event) => (
            <a
              key={event.slug}
              className={`homepage-event-card ${event.status}`}
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
        <p>&copy; 32. PTO Severka a Ševa</p>
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
