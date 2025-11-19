import { useState } from 'react';

const NAV_LINKS = [
  { label: 'Domů', href: '#hero' },
  { label: 'O Zelené lize', href: '#o-zelene-lize' },
  { label: 'Oddíly SPTO', href: '#oddily' },
  { label: 'Akce a výsledky', href: '#poradi' },
  { label: 'Sborníčky', href: '#sbornicky' },
  { label: 'Kontakt / Pro vedoucí', href: '#kontakt' },
];

const ODDILY = [
  {
    name: '6. PTO Nibowaka',
    city: 'Brno',
    description: 'Legendární oddíl, který vede děti k samostatnosti, přírodě a dobré partě.',
  },
  {
    name: '32. PTO Severka',
    city: 'Brno',
    description: 'Spojuje tábornické tradice s moderními postupy a důrazem na týmovost.',
  },
  {
    name: '17. PTO Draci',
    city: 'Znojmo',
    description: 'Oddíl pro všechny, kteří milují dobrodružství a výzvy v přírodě.',
  },
  {
    name: '9. PTO Lišáci',
    city: 'Vyškov',
    description: 'Lišáci bodují na atletice, orientaci i v deskových hrách.',
  },
  {
    name: '1. PTO Trampové',
    city: 'Blansko',
    description: 'Dlouholetá základna výprav, táborových ohňů a fair play.',
  },
  {
    name: '5. PTO Polaris',
    city: 'Břeclav',
    description: 'Dává prostor nováčkům i zkušeným vedoucím, kteří táhnou za jeden provaz.',
  },
];

const STANDINGS = [
  { rank: 1, name: '6. PTO Nibowaka', points: 128 },
  { rank: 2, name: '32. PTO Severka', points: 119 },
  { rank: 3, name: '17. PTO Draci', points: 111 },
  { rank: 4, name: '9. PTO Lišáci', points: 104 },
  { rank: 5, name: '1. PTO Trampové', points: 97 },
  { rank: 6, name: '5. PTO Polaris', points: 90 },
  { rank: 7, name: '24. PTO Hvězda', points: 82 },
];

const SBORNICKY = [
  {
    title: 'Sborníček 2015–2020',
    description:
      'Shrnutí pěti ročníků Zelené ligy, vyprávění vedoucích a výsledky všech závodů.',
  },
  {
    title: 'Sborníček 2010–2015',
    description: 'Co se dělo v oddílech, kdo vyhrál Setonův závod a jak se vyvíjela SPTO.',
  },
  {
    title: 'Sborníček 2005–2010',
    description: 'Historie Zelené ligy zachycená ve fotografiích, statistikách a příbězích.',
  },
];

function ZelenaLigaHomePage() {
  const [menuOpen, setMenuOpen] = useState(false);

  const closeMenu = () => setMenuOpen(false);

  return (
    <div className="min-h-screen bg-gradient-to-b from-emerald-50 via-white to-emerald-100 text-slate-900">
      <header className="sticky top-0 z-50 border-b border-emerald-100 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 md:px-6">
          <a href="#hero" className="text-lg font-semibold text-emerald-700">
            Zelená liga SPTO
          </a>
          <nav className="hidden items-center gap-6 text-sm font-medium text-slate-600 lg:flex">
            {NAV_LINKS.map((link) => (
              <a key={link.label} href={link.href} className="transition hover:text-emerald-700">
                {link.label}
              </a>
            ))}
          </nav>
          <button
            type="button"
            className="flex h-10 w-10 items-center justify-center rounded-md border border-emerald-200 text-emerald-700 lg:hidden"
            onClick={() => setMenuOpen((prev) => !prev)}
            aria-label="Otevřít menu"
          >
            <span className="sr-only">Menu</span>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              className="h-6 w-6"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
        </div>
        {menuOpen && (
          <div className="lg:hidden">
            <nav className="space-y-1 border-t border-emerald-100 bg-white px-4 py-3 text-sm font-medium text-slate-600">
              {NAV_LINKS.map((link) => (
                <a
                  key={link.label}
                  href={link.href}
                  onClick={closeMenu}
                  className="block rounded-md px-3 py-2 transition hover:bg-emerald-50 hover:text-emerald-700"
                >
                  {link.label}
                </a>
              ))}
            </nav>
          </div>
        )}
      </header>

      <main>
        <section id="hero" className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-16 text-center md:py-24">
          <p className="text-sm uppercase tracking-[0.3em] text-emerald-600">Společná soutěž SPTO</p>
          <h1 className="text-3xl font-semibold text-slate-900 sm:text-4xl md:text-5xl">Zelená liga SPTO</h1>
          <p className="text-lg text-slate-600 md:text-xl">
            Celoroční soutěž pionýrských tábornických oddílů z Jihomoravského kraje.
          </p>
          <p className="text-base leading-relaxed text-slate-600 md:text-lg">
            Oddíly mezi sebou soutěží v tábornických dovednostech, orientaci v přírodě, sportu i týmové spolupráci.
            Během roku proběhne několik závodů – od atletiky přes zabíjenou až po Setonův závod.
          </p>
          <div className="flex flex-col gap-3 sm:flex-row sm:justify-center">
            <a
              href="#o-zelene-lize"
              className="rounded-full bg-emerald-600 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-emerald-200 transition hover:bg-emerald-700"
            >
              Jak Zelená liga funguje
            </a>
            <a
              href="#poradi"
              className="rounded-full border border-emerald-200 px-6 py-3 text-sm font-semibold text-emerald-700 transition hover:border-emerald-400"
            >
              Aktuální pořadí
            </a>
          </div>
        </section>

        <section id="o-zelene-lize" className="bg-white py-16">
          <div className="mx-auto max-w-4xl px-4">
            <p className="text-sm font-semibold uppercase tracking-wide text-emerald-600">O Zelené lize</p>
            <h2 className="mt-3 text-3xl font-semibold text-slate-900">Co je Zelená liga?</h2>
            <p className="mt-4 text-lg text-slate-700">
              Zelená liga je celoroční soutěž tábornických oddílů SPTO. Oddíly sbírají body na různých závodech během roku – od sportovních klání přes tábornické disciplíny až po Setonův závod. Na konci roku nejúspěšnější oddíly získají čestné nášivky Zelené ligy.
            </p>
            <p className="mt-4 text-base text-slate-600">
              Každý oddíl má svou tradici, zvyky a styl práce – všechny ale spojuje společná chuť být venku, hrát fair play a růst společně.
            </p>
          </div>
        </section>

        <section id="oddily" className="py-16">
          <div className="mx-auto max-w-6xl px-4">
            <div className="md:flex md:items-center md:justify-between">
              <div>
                <p className="text-sm font-semibold uppercase tracking-wide text-emerald-600">Oddíly SPTO</p>
                <h2 className="mt-2 text-3xl font-semibold text-slate-900">Oddíly zapojené do Zelené ligy</h2>
              </div>
              <p className="mt-4 text-base text-slate-600 md:mt-0 md:max-w-xl">
                Zelená liga spojuje tábornické oddíly z celého Jihomoravského kraje. Níže je ukázka některých z nich.
              </p>
            </div>
            <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {ODDILY.map((oddil) => (
                <div key={oddil.name} className="rounded-2xl border border-emerald-100 bg-white p-6 shadow-sm">
                  <p className="text-xs uppercase tracking-wide text-emerald-500">{oddil.city}</p>
                  <h3 className="mt-2 text-xl font-semibold text-slate-900">{oddil.name}</h3>
                  <p className="mt-3 text-sm text-slate-600">{oddil.description}</p>
                  <a
                    href="#"
                    className="mt-5 inline-flex items-center text-sm font-semibold text-emerald-700 hover:text-emerald-900"
                  >
                    Detail oddílu
                    <span aria-hidden="true" className="ml-1">→</span>
                  </a>
                </div>
              ))}
            </div>
            <div className="mt-8 text-right">
              <a href="#" className="text-sm font-semibold text-emerald-700 hover:text-emerald-900">
                Zobrazit všechny oddíly SPTO →
              </a>
            </div>
          </div>
        </section>

        <section id="poradi" className="bg-slate-900 py-16 text-white">
          <div className="mx-auto max-w-5xl px-4">
            <p className="text-sm font-semibold uppercase tracking-wide text-emerald-300">Pořadí</p>
            <h2 className="mt-2 text-3xl font-semibold">Pořadí v aktuálním ročníku Zelené ligy</h2>
            <p className="mt-4 text-base text-slate-200">
              Během školního roku sbírají oddíly body na jednotlivých závodech. Na konci roku sedm nejlepších získá právo nosit čestnou nášivku Zelené ligy.
            </p>
            <div className="mt-8 overflow-x-auto">
              <table className="min-w-full divide-y divide-white/10 text-left text-sm">
                <thead>
                  <tr className="text-xs uppercase tracking-wide text-emerald-200">
                    <th className="py-3 pr-4">Pořadí</th>
                    <th className="py-3 pr-4">Oddíl</th>
                    <th className="py-3">Body</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {STANDINGS.map((item) => (
                    <tr key={item.rank}>
                      <td className="py-3 pr-4 font-semibold text-emerald-200">{item.rank}.</td>
                      <td className="py-3 pr-4 text-white">{item.name}</td>
                      <td className="py-3 text-white">{item.points}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-6 text-sm font-semibold text-emerald-200">
              <a href="#">Zobrazit kompletní tabulku a výsledky závodů →</a>
            </p>
          </div>
        </section>

        <section id="sbornicky" className="py-16">
          <div className="mx-auto max-w-5xl px-4">
            <p className="text-sm font-semibold uppercase tracking-wide text-emerald-600">Sborníčky</p>
            <h2 className="mt-2 text-3xl font-semibold text-slate-900">Sborníčky Zelené ligy</h2>
            <p className="mt-4 text-base text-slate-600">
              Každý sborníček shrnuje zhruba pět let života SPTO – výsledky všech závodů Zelené ligy, změny ve vedení SPTO i dění v jednotlivých oddílech. Můžete je číst online nebo stáhnout jako PDF.
            </p>
            <div className="mt-10 grid gap-6 md:grid-cols-2">
              {SBORNICKY.map((sbornicek) => (
                <div key={sbornicek.title} className="rounded-2xl border border-emerald-100 bg-white p-6 shadow-sm">
                  <h3 className="text-xl font-semibold text-slate-900">{sbornicek.title}</h3>
                  <p className="mt-3 text-sm text-slate-600">{sbornicek.description}</p>
                  <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                    <a
                      href="#"
                      className="flex-1 rounded-full bg-emerald-600 px-4 py-2 text-center text-sm font-semibold text-white transition hover:bg-emerald-700"
                    >
                      Otevřít PDF
                    </a>
                    <a
                      href="#"
                      className="flex-1 rounded-full border border-emerald-200 px-4 py-2 text-center text-sm font-semibold text-emerald-700 transition hover:border-emerald-400"
                    >
                      Stáhnout PDF
                    </a>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="o-spto" className="bg-emerald-50 py-14">
          <div className="mx-auto max-w-4xl px-4 text-center">
            <p className="text-sm font-semibold uppercase tracking-wide text-emerald-600">O SPTO</p>
            <h3 className="mt-2 text-2xl font-semibold text-slate-900">Co je SPTO?</h3>
            <p className="mt-4 text-base text-slate-700">
              Sdružení pionýrských tábornických oddílů (SPTO) je spolek jihomoravských pionýrských oddílů, které se zaměřují na turistiku, tábornictví a poznávání přírody. Zelená liga je jejich společná celoroční soutěž.
            </p>
          </div>
        </section>
      </main>

      <footer id="kontakt" className="border-t border-emerald-100 bg-white py-8">
        <div className="mx-auto flex max-w-5xl flex-col gap-6 px-4 text-sm text-slate-600 md:flex-row md:items-center md:justify-between">
          <p className="text-base font-medium text-slate-700">© {new Date().getFullYear()} Zelená liga SPTO</p>
          <div className="flex flex-col gap-3 text-sm md:flex-row md:items-center md:gap-6">
            <a href="#" className="hover:text-emerald-700">
              Pro vedoucí
            </a>
            <a href="#" className="hover:text-emerald-700">
              Pro rodiče
            </a>
            <a href="mailto:info@zelenaliga.cz" className="hover:text-emerald-700">
              Kontakt
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}

export default ZelenaLigaHomePage;
