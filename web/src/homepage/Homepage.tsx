const EVENTS = [
  {
    slug: 'setonuv-zavod',
    name: 'Setonův závod',
    description:
      'Tábornická soutěž pro všechny oddíly SPTO. Hlídky prověřují dovednosti z oddílové praxe – mapa, buzola, uzly, první pomoc, spolupráce.',
    href: '/setonuv-zavod',
    status: 'available' as const,
  },
  {
    slug: 'draci-smycka',
    name: 'Dračí smyčka',
    description: 'Soutěž jednotlivců ve vázání uzlů. Nové ročníky připravujeme na stejném digitálním zázemí.',
    href: '/draci-smycka',
    status: 'coming-soon' as const,
  },
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
  return (
    <main className="min-h-screen bg-[#f3faec] text-slate-900">
      <div className="max-w-5xl mx-auto px-4 py-10 md:py-16 space-y-20">
        <section
          id="hero"
          className="flex flex-col md:flex-row gap-10 items-center md:items-start"
        >
          <div className="flex items-center justify-center w-full md:w-auto">
            <div className="h-28 w-28 rounded-full bg-white shadow flex items-center justify-center text-lg font-semibold tracking-wide text-emerald-600">
              SPTO
            </div>
          </div>
          <div className="space-y-4 max-w-3xl">
            <p className="text-xs tracking-[0.25em] uppercase text-slate-500">Zelená liga</p>
            <h1 className="text-4xl md:text-5xl font-bold tracking-tight">Digitální podpora soutěží SPTO</h1>
            <p className="text-sm md:text-base text-slate-700 leading-relaxed">
              Celoroční soutěž pionýrských tábornických oddílů z Jihomoravského kraje drží společnou nit – férový boj, táborové dovednosti a radost z pohybu v přírodě.
            </p>
            <p className="text-sm md:text-base text-slate-700 leading-relaxed">
              Vše vzniklo mezi vedoucími, kteří závody sami pořádají. Přidáváme jen tolik techniky, aby se výsledky daly připravit i sdílet elegantně a zůstalo víc času na oddílový život.
            </p>
            <div className="flex flex-col sm:flex-row gap-3">
              <a
                href="#o-zelene-lize"
                className="inline-flex items-center justify-center rounded-full bg-emerald-500 px-5 py-2.5 text-sm font-semibold text-white shadow hover:bg-emerald-400 transition"
              >
                Jak Zelená liga funguje
              </a>
              <a
                href="#poradi"
                className="inline-flex items-center justify-center rounded-full border border-emerald-200 px-5 py-2.5 text-sm font-semibold text-emerald-700 hover:border-emerald-400 transition"
              >
                Aktuální pořadí
              </a>
            </div>
          </div>
        </section>

        <section id="souteze" className="space-y-6">
          <div className="text-center space-y-3 max-w-3xl mx-auto">
            <h2 className="text-3xl md:text-4xl font-semibold tracking-tight">Naše soutěže</h2>
            <p className="text-sm text-slate-600">
              Najdete tu odkazy na systémy, přes které rozhodčí zapisují body a vedoucí sledují výsledky jednotlivých závodů.
            </p>
          </div>
          <div className="grid gap-6 md:grid-cols-2">
            {EVENTS.map((event) => (
              <article
                key={event.slug}
                className="bg-white rounded-3xl shadow-sm border border-amber-100 p-6 flex flex-col justify-between"
              >
                <div className="space-y-3">
                  <span className="text-xs font-semibold tracking-[0.2em] text-amber-500">Soutěž</span>
                  <h3 className="text-xl font-semibold">{event.name}</h3>
                  <p className="text-sm text-slate-600">{event.description}</p>
                </div>
                <div className="mt-6">
                  {event.status === 'available' ? (
                    <a
                      href={event.href}
                      className="inline-flex items-center rounded-full bg-amber-400 px-4 py-2 text-sm font-semibold text-slate-900 shadow hover:bg-amber-300 transition"
                    >
                      Otevřít soutěž
                    </a>
                  ) : (
                    <span className="inline-flex items-center rounded-full bg-slate-100 px-4 py-2 text-sm font-medium text-slate-600">
                      Připravujeme
                    </span>
                  )}
                </div>
              </article>
            ))}
          </div>
        </section>

        <section id="o-zelene-lize" className="space-y-4">
          <h2 className="text-3xl md:text-4xl font-semibold tracking-tight">O Zelené lize</h2>
          <div className="space-y-3 text-base text-slate-700 max-w-prose">
            <p>
              Zelená liga je celoroční soutěž tábornických oddílů SPTO. Oddíly sbírají body na různých závodech během roku – od sportovních klání přes tábornické disciplíny až po Setonův závod. Na konci roku nejúspěšnější oddíly získají čestné nášivky Zelené ligy.
            </p>
            <p>
              Každý oddíl má svou tradici, zvyky a styl práce – všechny ale spojuje společná chuť být venku, hrát fair play a růst společně.
            </p>
          </div>
        </section>

        <section id="oddily" className="space-y-6">
          <div className="space-y-2">
            <h2 className="text-3xl md:text-4xl font-semibold tracking-tight">Oddíly zapojené do Zelené ligy</h2>
            <p className="text-sm text-slate-600 max-w-prose">
              Zelená liga spojuje tábornické oddíly z celého Jihomoravského kraje. Níže je ukázka některých z nich.
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {ODDILY.map((oddil) => (
              <div key={oddil.name} className="bg-white rounded-2xl shadow-sm p-4 border border-slate-100">
                <h3 className="text-xl font-semibold">{oddil.name}</h3>
                <p className="text-sm text-slate-600">{oddil.city}</p>
                <p className="mt-2 text-sm text-slate-700">{oddil.description}</p>
                <button className="mt-3 text-sm font-medium text-emerald-700 hover:text-emerald-900">
                  Detail oddílu →
                </button>
              </div>
            ))}
          </div>
        </section>

        <section id="poradi" className="space-y-4">
          <div className="space-y-2 max-w-prose">
            <h2 className="text-3xl md:text-4xl font-semibold tracking-tight">Pořadí Zelené ligy</h2>
            <p className="text-sm text-slate-600">
              Během školního roku sbírají oddíly body na jednotlivých závodech. Na konci roku sedm nejlepších získá právo nosit čestnou nášivku Zelené ligy.
            </p>
          </div>
          <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-slate-500 uppercase text-xs tracking-wide">
                <tr>
                  <th className="py-3 px-4 text-left">Pořadí</th>
                  <th className="py-3 px-4 text-left">Oddíl</th>
                  <th className="py-3 px-4 text-right">Body</th>
                </tr>
              </thead>
              <tbody>
                {STANDINGS.map((item, index) => (
                  <tr key={item.rank} className={index % 2 === 0 ? 'bg-white' : 'bg-slate-50/60'}>
                    <td className="py-3 px-4 font-semibold text-slate-700">{item.rank}.</td>
                    <td className="py-3 px-4 text-slate-800">{item.name}</td>
                    <td className="py-3 px-4 text-right font-semibold text-slate-900">{item.points}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section id="sbornicky" className="space-y-6">
          <div className="space-y-2 max-w-prose">
            <h2 className="text-3xl md:text-4xl font-semibold tracking-tight">Sborníčky</h2>
            <p className="text-sm text-slate-600">
              Každý sborníček shrnuje několik ročníků Zelené ligy – výsledky závodů, novinky v oddílech i příběhy vedoucích.
            </p>
          </div>
          <div className="grid gap-6 md:grid-cols-2">
            {SBORNICKY.map((sbornicek) => (
              <article key={sbornicek.title} className="bg-white rounded-3xl shadow-sm border border-slate-100 p-6 space-y-4">
                <div>
                  <h3 className="text-xl font-semibold">{sbornicek.title}</h3>
                  <p className="text-sm text-slate-600 mt-2">{sbornicek.description}</p>
                </div>
                <div className="flex flex-col sm:flex-row gap-3">
                  <a
                    href="#"
                    className="flex-1 inline-flex items-center justify-center rounded-full bg-emerald-500 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-emerald-400 transition"
                  >
                    Otevřít PDF
                  </a>
                  <a
                    href="#"
                    className="flex-1 inline-flex items-center justify-center rounded-full border border-emerald-200 px-4 py-2 text-sm font-semibold text-emerald-700 hover:border-emerald-400 transition"
                  >
                    Stáhnout
                  </a>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section id="kontakt" className="space-y-3 max-w-prose">
          <h2 className="text-3xl md:text-4xl font-semibold tracking-tight">Kontakt &amp; podpora</h2>
          <p className="text-sm text-slate-600">
            Pro vedoucí i rodiče jsme na dosah. Napište nám na{' '}
            <a href="mailto:info@zelenaliga.cz" className="text-emerald-700 font-semibold hover:text-emerald-900">
              info@zelenaliga.cz
            </a>{' '}
            nebo se stavte na některé z akcí SPTO.
          </p>
          <p className="text-sm text-slate-600">© {new Date().getFullYear()} Zelená liga SPTO</p>
        </section>
      </div>
    </main>
  );
}

export default ZelenaLigaHomePage;
