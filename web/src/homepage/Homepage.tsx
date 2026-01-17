import './Homepage.css';
import { useEffect, useState } from 'react';
import type { MouseEvent } from 'react';
import AppFooter from '../components/AppFooter';
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
    description:
      'Tábornická soutěž pro všechny oddíly SPTO. Hlídky prověřují dovednosti z oddílové praxe – mapa, buzola, uzly, první pomoc, spolupráce.',
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

const NAV_ITEMS = [
  { id: 'souteze', label: 'Soutěže', icon: '⛺' },
  { id: 'zelenaliga', label: 'Zelená liga', icon: '🌿' },
  { id: 'oddily', label: 'Oddíly SPTO', icon: '🤝' },
  { id: 'fotogalerie', label: 'Fotogalerie', icon: '📸' },
  { id: 'clanky', label: 'Články a novinky', icon: '📰' },
  { id: 'historie', label: 'Historie SPTO', icon: '📜' },
];

const LEAGUE_TOP = [
  { name: 'PTO Severka', city: 'Brno' },
  { name: 'PTO Ševa', city: 'Brno' },
  { name: 'PTO Orion', city: 'Blansko' },
  { name: 'PTO Tis', city: 'Třebíč' },
  { name: 'PTO Rosa', city: 'Hodonín' },
];

const ARTICLES = [
  {
    title: 'Setonův závod 2025: víkend plný týmové hry',
    dateLabel: '15. 5. 2025',
    dateISO: '2025-05-15',
    excerpt: 'Hlídky z celé republiky si vyzkoušely orientaci, uzly i táborový provoz v terénu.',
    href: '/clanky/setonuv-zavod-2025',
  },
  {
    title: 'Dračí smyčka: nová generace uzlařů',
    dateLabel: '2. 4. 2025',
    dateISO: '2025-04-02',
    excerpt: 'Soutěž jednotlivců ukázala, že tradice vázání uzlů je stále živá.',
    href: '/clanky/draci-smycka-2025',
  },
  {
    title: 'Zelená liga odstartovala jarní část sezóny',
    dateLabel: '20. 3. 2025',
    dateISO: '2025-03-20',
    excerpt: 'Oddíly sbírají první body a těší se na další soutěže.',
    href: '/clanky/zelena-liga-jar-2025',
  },
];

// TODO: Napojit na API / Supabase pro reálné pořadí Zelené ligy.

// TODO: Napojení fotogalerie přes Google Drive API (Service Account).
// Root složka sdílená na e-mail service accountu, ENV:
// - GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON_BASE64
// - GOOGLE_DRIVE_ROOT_FOLDER_ID
// Server endpoint by měl umět:
// - vypsat seznam školních roků (podsložky rootu)
// - vypsat seznam akcí v konkrétním roce
// - vypsat fotky v konkrétní akci (id, name, thumbnailLink)
// Důležité: whitelist metadata + jednoduchý TTL cache.
const GALLERY_PREVIEW = [
  { id: '1', src: logo, alt: 'Ukázková fotka z tábora SPTO' },
  { id: '2', src: logo, alt: 'Ukázková fotka ze závodu Zelené ligy' },
  { id: '3', src: logo, alt: 'Ukázková fotka z výpravy SPTO' },
  { id: '4', src: logo, alt: 'Ukázková fotka z oddílové schůzky' },
  { id: '5', src: logo, alt: 'Ukázková fotka z táborového dne' },
  { id: '6', src: logo, alt: 'Ukázková fotka z přírody s oddílem' },
];

const TROOPS = [
  {
    name: 'PTO Severka',
    city: 'Brno',
    description: 'Tradiční oddíl se zaměřením na tábornictví a hry v přírodě.',
    href: '/oddily/severka',
  },
  {
    name: 'PTO Ševa',
    city: 'Brno',
    description: 'Silná parta vedoucích, víkendové výpravy a letní expedice.',
    href: '/oddily/seva',
  },
  {
    name: 'PTO Orion',
    city: 'Blansko',
    description: 'Oddíl pro mladší i starší, důraz na spolupráci a dovednosti.',
    href: '/oddily/orion',
  },
  {
    name: 'PTO Rosa',
    city: 'Hodonín',
    description: 'Pestrý program, tábory u vody a tradice pionýrských hodnot.',
    href: '/oddily/rosa',
  },
];

const HEADER_SUBTITLE = 'Soutěže, oddíly a informace na jednom místě.';

const APPLICATION_LINKS = [
  {
    label: 'Setonův závod – aplikace',
    description: 'Hlavní rozhraní pro sběr bodů a správu stanovišť.',
    href: '/setonuv-zavod',
  },
  {
    label: 'Výsledková tabule',
    description: 'Aktuální pořadí hlídek a přehled bodů.',
    href: '/setonuv-zavod/vysledky',
  },
];

type InfoLink = {
  label: string;
  description?: string;
  href: string;
};

function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function NotFoundPage() {
  return (
    <SiteShell>
      <main className="homepage-main homepage-single">
        <h1>Stránka nebyla nalezena</h1>
        <p>Omlouváme se, ale požadovaná stránka neexistuje. Zkuste se vrátit na domovskou stránku.</p>
        <a className="homepage-back-link" href="/">
          Zpět na Zelenou ligu
        </a>
      </main>
    </SiteShell>
  );
}

function InfoPage({
  eyebrow,
  title,
  lead,
  links,
  backHref = '/',
}: {
  eyebrow?: string;
  title: string;
  lead: string;
  links?: InfoLink[];
  backHref?: string;
}) {
  return (
    <SiteShell>
      <main className="homepage-main homepage-single" aria-labelledby="info-heading">
        {eyebrow ? <p className="homepage-eyebrow">{eyebrow}</p> : null}
        <h1 id="info-heading">{title}</h1>
        <p className="homepage-lead">{lead}</p>
        <div className="homepage-card">
          {links && links.length > 0 ? (
            <ul className="homepage-list">
              {links.map((link) => (
                <li key={link.href}>
                  <a className="homepage-inline-link" href={link.href}>
                    {link.label}
                  </a>
                  {link.description ? <p>{link.description}</p> : null}
                </li>
              ))}
            </ul>
          ) : (
            <p>Obsah stránky připravujeme. Sleduj novinky na hlavní stránce.</p>
          )}
        </div>
        <a className="homepage-back-link" href={backHref}>
          Zpět na hlavní stránku
        </a>
      </main>
    </SiteShell>
  );
}

function SiteHeader({
  activeSection,
  onNavClick,
}: {
  activeSection?: string;
  onNavClick?: (id: string) => (event: MouseEvent<HTMLAnchorElement>) => void;
}) {
  return (
    <>
      <header className="homepage-header">
        <div className="homepage-header-inner">
          <a className="homepage-hero-logo" href="https://zelenaliga.cz" target="_blank" rel="noreferrer">
            <img src={logo} alt="Logo Zelená liga" />
            <span className="homepage-logo-caption">SPTO Brno</span>
          </a>
          <div className="homepage-header-copy">
            <p className="homepage-eyebrow">SPTO · Zelená liga</p>
            <h1>SPTO a Zelená liga</h1>
            <p className="homepage-subtitle">{HEADER_SUBTITLE}</p>
          </div>
          <div className="homepage-cta-group" role="group" aria-label="Hlavní odkazy">
            <a className="homepage-cta primary" href="/zelena-liga">
              Aktuální pořadí Zelené ligy
            </a>
            <a className="homepage-cta secondary homepage-cta-accent" href="/aplikace">
              Soutěže a aplikace
            </a>
          </div>
        </div>
      </header>

      <nav className="homepage-nav" aria-label="Hlavní navigace">
        <div className="homepage-nav-inner">
          {NAV_ITEMS.map((item) => {
            const isActive = activeSection === item.id;
            const href = onNavClick ? `#${item.id}` : `/#${item.id}`;
            return (
              <a
                key={item.id}
                href={href}
                onClick={onNavClick ? onNavClick(item.id) : undefined}
                aria-current={isActive ? 'page' : undefined}
                className={`homepage-nav-link${isActive ? ' is-active' : ''}`}
              >
                <span className="homepage-nav-dot" aria-hidden="true" />
                {item.label}
              </a>
            );
          })}
        </div>
      </nav>
    </>
  );
}

function SiteShell({
  children,
  activeSection,
  onNavClick,
}: {
  children: React.ReactNode;
  activeSection?: string;
  onNavClick?: (id: string) => (event: MouseEvent<HTMLAnchorElement>) => void;
}) {
  return (
    <div className="homepage-shell" style={{ scrollBehavior: 'smooth' }}>
      <SiteHeader activeSection={activeSection} onNavClick={onNavClick} />
      {children}
      <AppFooter className="homepage-footer" />
    </div>
  );
}

function Homepage() {
  const [featuredPhoto, ...galleryThumbnails] = GALLERY_PREVIEW;
  const [activeSection, setActiveSection] = useState(NAV_ITEMS[0]?.id ?? '');

  useEffect(() => {
    const sections = NAV_ITEMS.map((item) => document.getElementById(item.id)).filter(
      (section): section is HTMLElement => Boolean(section),
    );

    if (sections.length === 0) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const visibleEntry = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];

        if (visibleEntry?.target instanceof HTMLElement) {
          setActiveSection(visibleEntry.target.id);
        }
      },
      { threshold: [0.25, 0.5, 0.75], rootMargin: '-10% 0px -55% 0px' },
    );

    sections.forEach((section) => observer.observe(section));

    return () => {
      observer.disconnect();
    };
  }, []);

  const handleNavClick = (id: string) => (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    const target = document.getElementById(id);
    if (!target) {
      return;
    }
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    window.history.replaceState(null, '', `#${id}`);
  };

  return (
    <SiteShell activeSection={activeSection} onNavClick={handleNavClick}>
      <main className="homepage-main" aria-labelledby="homepage-intro-heading" style={{ maxWidth: '1120px', gap: '64px' }}>
        <section className="homepage-section" aria-labelledby="homepage-intro-heading">
          <div className="homepage-section-header" style={{ textAlign: 'left', alignItems: 'flex-start', maxWidth: '720px' }}>
            <h2 id="homepage-intro-heading">O SPTO a Zelené lize</h2>
            <span className="homepage-section-accent" aria-hidden="true" style={{ alignSelf: 'flex-start' }} />
          </div>
          <div className="homepage-card" style={{ maxWidth: '920px', boxShadow: 'none' }}>
            <p>
              SPTO sdružuje pionýrské tábornické oddíly (PTO), které vedou děti a mladé k pobytu v přírodě,
              spolupráci a dobrodružství. Pravidelné schůzky, víkendové výpravy i letní tábory jsou otevřené všem,
              kdo chtějí zažít táborový život naplno.
            </p>
            <p style={{ marginTop: '12px' }}>
              Zelená liga je celoroční soutěžní rámec SPTO. Skládá se z několika závodů během roku
              (například Setonův závod) a soutěžící jsou rozděleni do věkových kategorií.
            </p>
          </div>
        </section>

        <section className="homepage-section" id="souteze" aria-labelledby="souteze-heading">
          <div className="homepage-section-header" style={{ textAlign: 'left', alignItems: 'flex-start', maxWidth: '720px' }}>
            <h2 id="souteze-heading">Soutěže</h2>
            <span className="homepage-section-accent" aria-hidden="true" style={{ alignSelf: 'flex-start' }} />
            <p>Stručný rozcestník k hlavním soutěžím a jejich digitálním aplikacím.</p>
          </div>
          <div className="homepage-card" style={{ maxWidth: '920px', boxShadow: 'none' }}>
            <ul className="homepage-list">
              {EVENTS.map((event) => (
                <li key={event.slug}>
                  <a className="homepage-inline-link" href={event.href}>
                    {event.name}
                  </a>{' '}
                  – {event.description}
                </li>
              ))}
            </ul>
            <a className="homepage-inline-link" href="/souteze" style={{ marginTop: '12px', display: 'inline-flex' }}>
              Zobrazit všechny soutěže
            </a>
          </div>
        </section>

        <section className="homepage-section" id="zelenaliga" aria-labelledby="zelenaliga-heading">
          <div className="homepage-section-header" style={{ textAlign: 'left', alignItems: 'flex-start', maxWidth: '720px' }}>
            <h2 id="zelenaliga-heading">Zelená liga</h2>
            <span className="homepage-section-accent" aria-hidden="true" style={{ alignSelf: 'flex-start' }} />
            <p>Celoroční soutěžní rámec SPTO spojující oddíly napříč republikou.</p>
          </div>
          <div
            className="homepage-card homepage-league-card"
            style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '32px' }}
          >
            <div className="homepage-league-copy" style={{ maxWidth: '520px' }}>
              <p>
                Zelená liga sbírá body z několika soutěží během školního roku a motivuje oddíly
                k pravidelné činnosti, týmové práci a rozvoji dovedností v přírodě.
              </p>
              <div aria-hidden="true" style={{ height: '1px', background: 'rgba(4, 55, 44, 0.12)' }} />
              <div className="homepage-toggle" role="group" aria-label="Přepnout zobrazení ligy">
                <button type="button" className="homepage-toggle-button is-active" aria-pressed="true">
                  Aktuální sezóna
                </button>
                <button type="button" className="homepage-toggle-button" aria-pressed="false">
                  Historie
                </button>
              </div>
              <a className="homepage-cta secondary" href="/zelena-liga">
                Zobrazit celé pořadí
              </a>
            </div>
            <div className="homepage-league-top" style={{ padding: '24px' }}>
              <h3>Top 5 oddílů</h3>
              <ol>
                {LEAGUE_TOP.map((troop, index) => (
                  <li
                    key={troop.name}
                    style={{ display: 'grid', gridTemplateColumns: '32px 1fr', gap: '12px', alignItems: 'center' }}
                  >
                    <span className="homepage-league-rank" style={{ textAlign: 'right' }}>
                      {index + 1}.
                    </span>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                      <strong>{troop.name}</strong>
                      <span>{troop.city}</span>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </section>

        <section className="homepage-section" id="clanky" aria-labelledby="clanky-heading">
          <div className="homepage-section-header" style={{ textAlign: 'left', alignItems: 'flex-start', maxWidth: '720px' }}>
            <h2 id="clanky-heading">Články ze soutěží</h2>
            <span className="homepage-section-accent" aria-hidden="true" style={{ alignSelf: 'flex-start' }} />
            <p>Krátké reportáže a novinky z posledních závodů a akcí.</p>
          </div>
          <div className="homepage-article-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
            {ARTICLES.map((article) => (
              <article key={article.title} className="homepage-article-card" style={{ minHeight: '220px' }}>
                <div className="homepage-article-meta" style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <time
                    dateTime={article.dateISO}
                    style={{
                      display: 'inline-flex',
                      padding: '4px 10px',
                      borderRadius: '999px',
                      background: 'rgba(4, 55, 44, 0.08)',
                      fontWeight: 600,
                    }}
                  >
                    {article.dateLabel}
                  </time>
                </div>
                <h3
                  style={{
                    display: '-webkit-box',
                    WebkitBoxOrient: 'vertical',
                    WebkitLineClamp: 2,
                    overflow: 'hidden',
                  }}
                >
                  {article.title}
                </h3>
                <p
                  style={{
                    display: '-webkit-box',
                    WebkitBoxOrient: 'vertical',
                    WebkitLineClamp: 2,
                    overflow: 'hidden',
                  }}
                >
                  {article.excerpt}
                </p>
                <a className="homepage-inline-link" href={article.href} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                  Číst článek <span aria-hidden="true">→</span>
                </a>
              </article>
            ))}
          </div>
          <div className="homepage-section-cta">
            <a className="homepage-cta secondary" href="/clanky">
              Všechny články
            </a>
          </div>
        </section>

        <section className="homepage-section" id="fotogalerie" aria-labelledby="fotogalerie-heading">
          <div className="homepage-section-header" style={{ textAlign: 'left', alignItems: 'flex-start', maxWidth: '720px' }}>
            <h2 id="fotogalerie-heading">Fotogalerie</h2>
            <span className="homepage-section-accent" aria-hidden="true" style={{ alignSelf: 'flex-start' }} />
            <p>Malý výběr z poslední akce – kompletní alba najdeš ve fotogalerii.</p>
          </div>
          <div className="homepage-card homepage-gallery-card">
            <div
              className="homepage-gallery-grid"
              style={{
                gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
                gap: '16px',
              }}
            >
              {featuredPhoto ? (
                <div
                  style={{
                    borderRadius: '20px',
                    overflow: 'hidden',
                    border: '1px solid rgba(4, 55, 44, 0.12)',
                    background: 'rgba(4, 55, 44, 0.06)',
                  }}
                >
                  <img
                    src={featuredPhoto.src}
                    alt={featuredPhoto.alt}
                    loading="lazy"
                    style={{ width: '100%', height: '100%', objectFit: 'cover', aspectRatio: '16 / 9' }}
                  />
                </div>
              ) : null}
              <div style={{ display: 'grid', gap: '12px', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
                {galleryThumbnails.slice(0, 3).map((photo) => (
                  <img
                    key={photo.id}
                    src={photo.src}
                    alt={photo.alt}
                    loading="lazy"
                    style={{
                      width: '100%',
                      height: '100%',
                      objectFit: 'cover',
                      borderRadius: '16px',
                      border: '1px solid rgba(4, 55, 44, 0.1)',
                      aspectRatio: '16 / 9',
                      background: 'rgba(4, 55, 44, 0.05)',
                    }}
                  />
                ))}
              </div>
            </div>
            <div className="homepage-gallery-actions">
              <a className="homepage-cta secondary" href="/fotogalerie">
                Otevřít fotogalerii
              </a>
              <p className="homepage-gallery-note">
                Odkazy na roky: <a href="/fotogalerie">/fotogalerie</a>, akce: <a href="/fotogalerie/2024-2025/setonuv-zavod">/fotogalerie/[rok]/[akce]</a>
              </p>
            </div>
          </div>
        </section>

        <section className="homepage-section" id="oddily" aria-labelledby="oddily-heading">
          <div className="homepage-section-header" style={{ textAlign: 'left', alignItems: 'flex-start', maxWidth: '720px' }}>
            <h2 id="oddily-heading">Oddíly SPTO</h2>
            <span className="homepage-section-accent" aria-hidden="true" style={{ alignSelf: 'flex-start' }} />
            <p>Čtyři oddíly na ukázku – další najdeš v kompletním seznamu.</p>
          </div>
          <div className="homepage-troop-grid">
            {TROOPS.map((troop) => (
              <a key={troop.name} className="homepage-troop-card" href={troop.href}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <h3>{troop.name}</h3>
                  <span className="homepage-troop-city">{troop.city}</span>
                </div>
                <p
                  style={{
                    display: '-webkit-box',
                    WebkitBoxOrient: 'vertical',
                    WebkitLineClamp: 2,
                    overflow: 'hidden',
                  }}
                >
                  {troop.description}
                </p>
                <span className="homepage-inline-link" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                  Detail oddílu <span aria-hidden="true">→</span>
                </span>
              </a>
            ))}
          </div>
          <div className="homepage-section-cta">
            <a className="homepage-cta secondary" href="/oddily">
              Seznam oddílů
            </a>
          </div>
        </section>

        <section className="homepage-section" id="historie" aria-labelledby="historie-heading">
          <div className="homepage-section-header" style={{ textAlign: 'left', alignItems: 'flex-start', maxWidth: '720px' }}>
            <h2 id="historie-heading">Historie SPTO stručně</h2>
            <span className="homepage-section-accent" aria-hidden="true" style={{ alignSelf: 'flex-start' }} />
            <p>Tradice pionýrského tábornictví sahá desítky let zpět.</p>
          </div>
          <div className="homepage-card" style={{ maxWidth: '880px' }}>
            <p>
              SPTO vzniklo jako dobrovolné sdružení oddílů, které chtěly rozvíjet pobyt v přírodě,
              týmovou spolupráci a zodpovědnost u dětí i vedoucích. Postupně se rozrostlo o nové soutěže,
              setkání a celoroční ligu, která propojuje oddíly napříč kraji.
            </p>
            <a className="homepage-inline-link" href="/historie">
              Přečíst historii
            </a>
          </div>
        </section>
      </main>
    </SiteShell>
  );
}

interface EventPageProps {
  slug: string;
}

function EventPage({ slug }: EventPageProps) {
  const event = EVENTS.find((item) => item.slug === slug);

  if (!event) {
    return <NotFoundPage />;
  }

  return (
    <SiteShell>
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
    </SiteShell>
  );
}

export default function ZelenaligaSite() {
  const path = window.location.pathname.replace(/\/$/, '') || '/';
  const segments = path.split('/').filter(Boolean);

  if (path === '/') {
    return <Homepage />;
  }

  if (segments.length > 0) {
    const slug = segments[0];
    const event = EVENTS.find((item) => item.slug === slug);
    if (event) {
      return <EventPage slug={slug} />;
    }

    if (slug === 'souteze') {
      return (
        <InfoPage
          eyebrow="SPTO · Soutěže"
          title="Soutěže SPTO"
          lead="Přehled hlavních závodů, které tvoří Zelenou ligu."
          links={EVENTS.map((item) => ({
            label: item.name,
            description: item.description,
            href: item.href,
          }))}
        />
      );
    }

    if (slug === 'zelena-liga') {
      return (
        <InfoPage
          eyebrow="SPTO · Zelená liga"
          title="Zelená liga"
          lead="Celoroční soutěžní rámec oddílů SPTO, který sbírá body z jednotlivých závodů."
          links={[
            {
              label: 'Aktuální pořadí',
              description: 'Podívej se na průběžné výsledky a bodové součty.',
              href: '/setonuv-zavod/vysledky',
            },
            {
              label: 'Jak se zapojit',
              description: 'Informace o přihláškách a pravidlech hlavních závodů.',
              href: '/souteze',
            },
          ]}
        />
      );
    }

    if (slug === 'aplikace') {
      return (
        <InfoPage
          eyebrow="SPTO · Aplikace"
          title="Soutěže a aplikace"
          lead="Digitální nástroje pro správu závodů, bodování i výsledků."
          links={APPLICATION_LINKS}
        />
      );
    }

    if (slug === 'oddily') {
      if (segments.length > 1) {
        const troopSlug = segments[1];
        const troop = TROOPS.find((item) => item.href.split('/').pop() === troopSlug);
        if (!troop) {
          return <NotFoundPage />;
        }
        return (
          <InfoPage
            eyebrow="SPTO · Oddíly"
            title={troop.name}
            lead={`${troop.city} · ${troop.description}`}
            links={[
              {
                label: 'Zpět na seznam oddílů',
                href: '/oddily',
              },
            ]}
            backHref="/oddily"
          />
        );
      }
      return (
        <InfoPage
          eyebrow="SPTO · Oddíly"
          title="Oddíly SPTO"
          lead="Seznam oddílů zapojených do pionýrského tábornictví."
          links={TROOPS.map((item) => ({
            label: item.name,
            description: `${item.city} · ${item.description}`,
            href: item.href,
          }))}
        />
      );
    }

    if (slug === 'clanky') {
      if (segments.length > 1) {
        const articleSlug = segments[1];
        const article = ARTICLES.find((item) => item.href.split('/').pop() === articleSlug);
        if (!article) {
          return <NotFoundPage />;
        }
        return (
          <InfoPage
            eyebrow="SPTO · Článek"
            title={article.title}
            lead={`${article.dateLabel} · ${article.excerpt}`}
            links={[
              {
                label: 'Zpět na seznam článků',
                href: '/clanky',
              },
            ]}
            backHref="/clanky"
          />
        );
      }
      return (
        <InfoPage
          eyebrow="SPTO · Články"
          title="Články ze soutěží"
          lead="Reportáže a novinky z posledních akcí."
          links={ARTICLES.map((item) => ({
            label: item.title,
            description: `${item.dateLabel} · ${item.excerpt}`,
            href: item.href,
          }))}
        />
      );
    }

    if (slug === 'fotogalerie') {
      if (segments.length > 1) {
        const galleryTitle = segments
          .slice(1)
          .map((segment) => slugify(segment).replace(/-/g, ' '))
          .join(' · ');
        return (
          <InfoPage
            eyebrow="SPTO · Fotogalerie"
            title={`Fotogalerie ${galleryTitle}`}
            lead="Fotky z vybrané akce připravujeme. Kompletní galerie budou postupně doplňovány."
            links={[
              {
                label: 'Zpět na fotogalerii',
                href: '/fotogalerie',
              },
            ]}
            backHref="/fotogalerie"
          />
        );
      }
      return (
        <InfoPage
          eyebrow="SPTO · Fotogalerie"
          title="Fotogalerie"
          lead="Fotky z výprav a závodů SPTO. Další alba přidáme brzy."
          links={[
            {
              label: 'Zelená liga 2024/2025',
              description: 'Ukázkové album ze Setonova závodu.',
              href: '/fotogalerie/2024-2025/setonuv-zavod',
            },
          ]}
        />
      );
    }

    if (slug === 'historie') {
      return (
        <InfoPage
          eyebrow="SPTO · Historie"
          title="Historie SPTO"
          lead="Pionýrské tábornictví má desítky let tradice. Připravujeme podrobnější přehled historie."
        />
      );
    }

    if (segments.length === 1) {
      const readableSlug = slugify(slug).replace(/-/g, ' ');
      return (
        <InfoPage
          eyebrow="SPTO · Zelená liga"
          title={readableSlug}
          lead="Obsah stránky připravujeme. Podívej se na hlavní rozcestník."
        />
      );
    }
  }

  return <NotFoundPage />;
}
