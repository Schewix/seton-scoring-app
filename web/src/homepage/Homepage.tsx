import './Homepage.css';
import { useEffect, useMemo, useState } from 'react';
import { PortableText } from '@portabletext/react';
import AppFooter from '../components/AppFooter';
import logo from '../assets/znak_SPTO_transparent.png';
import { fetchContentArticle, fetchContentArticles, type ContentArticle } from '../data/content';
import { fetchHomepage, hasSanityConfig, type SanityHomepage } from '../data/sanity';

interface Competition {
  slug: string;
  name: string;
  description?: string;
  href: string;
  ruleMatchers: string[];
}

const COMPETITIONS: Competition[] = [
  {
    slug: 'setonuv-zavod',
    name: 'Setonův závod',
    description: 'Týmový tábornický závod hlídek na stanovištích v přírodě.',
    href: '/souteze/setonuv-zavod',
    ruleMatchers: ['pravidla-souteze', 'pravidla-stanovist', 'setonuv', 'stavba-stanu'],
  },
  {
    slug: 'draci-smycka',
    name: 'Dračí smyčka',
    description: 'Soutěž jednotlivců ve vázání uzlů.',
    href: '/souteze/draci-smycka',
    ruleMatchers: ['draci-smycka'],
  },
  {
    slug: 'kosmuv-prostor',
    name: 'Kosmův prostor',
    description: 'Doplňková soutěž, kde děti a vedoucí hodnotí web, kroniku a fashion oddílů.',
    href: '/souteze/kosmuv-prostor',
    ruleMatchers: ['kosmuv-prostor'],
  },
  {
    slug: 'ringobal',
    name: 'Ringobal',
    description: 'Sportovní turnaj v ringobalu pro oddíly.',
    href: '/souteze/ringobal',
    ruleMatchers: ['ringobal'],
  },
  {
    slug: 'deskove-hry',
    name: 'Deskové hry',
    description: 'Soutěž jednotlivců v deskových hrách.',
    href: '/souteze/deskove-hry',
    ruleMatchers: ['deskove-hry'],
  },
  {
    slug: 'brnenske-bloudeni',
    name: 'Brněnské bloudění',
    description: 'Městská orientační hra v Brně pro týmy.',
    href: '/souteze/brnenske-bloudeni',
    ruleMatchers: ['bloudeni'],
  },
  {
    slug: 'piotrio',
    name: 'Pio Trio',
    description: 'Soutěž tříčlenných hlídek ve třech netradičních dovednostech.',
    href: '/souteze/piotrio',
    ruleMatchers: ['piotrio'],
  },
  {
    slug: 'karakoram',
    name: 'Karakoram',
    description: 'Soutěž šestičlených týmů v překonávání lanových překážek.',
    href: '/souteze/karakoram',
    ruleMatchers: ['karakoram'],
  },
  {
    slug: 'lakros',
    name: 'Lakros',
    description: 'Turnaj v pionýrském lakrosu podle soutěžních pravidel.',
    href: '/souteze/lakros',
    ruleMatchers: ['lakros'],
  },
  {
    slug: 'vybijena',
    name: 'Vybíjená',
    description: 'Sportovní turnaj ve vybíjené.',
    href: '/souteze/vybijena',
    ruleMatchers: ['vybijena'],
  },
  {
    slug: 'memorial-bedricha-stolicky',
    name: 'Memoriál Bedřicha Stolíčky',
    description: 'Soutěž pro jednotlivce v atletických, silových a mrštnostních disciplínách.',
    href: '/souteze/memorial-bedricha-stolicky',
    ruleMatchers: ['mbs'],
  },
];

const NAV_ITEMS = [
  { id: 'souteze', label: 'Soutěže', href: '/souteze' },
  { id: 'aktualni-poradi', label: 'Aktuální pořadí', href: '/aktualni-poradi' },
  { id: 'oddily', label: 'Oddíly SPTO', href: '/oddily' },
  { id: 'fotogalerie', label: 'Fotogalerie', href: '/fotogalerie' },
  { id: 'clanky', label: 'Články a novinky', href: '/clanky' },
  { id: 'o-spto', label: 'O SPTO', href: '/o-spto' },
  { id: 'kontakty', label: 'Kontakty', href: '/kontakty' },
];

const LEAGUE_EVENTS = [
  { key: 'pto-ob', label: 'PTO OB', name: 'Orientační běh' },
  { key: 'ds', label: 'DS', name: 'Dračí smyčka' },
  { key: 'kp', label: 'KP', name: 'Kosmův prostor' },
  { key: 'seton', label: 'Seton', name: 'Setonův závod' },
] as const;
const LEAGUE_TOP_COUNT = 7;

type LeagueEvent = (typeof LEAGUE_EVENTS)[number]['key'];

const LEAGUE_TROOPS = [
  { id: '63-phoenix', name: '63. PTO Phoenix' },
  { id: '6-nibowaka', name: '6. PTO Nibowaka' },
  { id: '66-brabrouci', name: '66. PTO Brabrouci' },
  { id: 'zs-pcv', name: 'ZS PCV' },
  { id: '10-severka', name: '10. PTO Severka' },
  { id: '176-vlcata', name: '176. PTO Vlčata' },
  { id: '34-tulak', name: '34. PTO Tulák' },
  { id: '21-hady', name: '21. PTO Hády' },
  { id: '32-severka', name: '32. PTO Severka' },
  { id: '64-lorien', name: '64. PTO Lorien' },
  { id: '48-stezka', name: '48. PTO Stezka' },
  { id: '2-poutnici', name: '2. PTO Poutníci' },
  { id: '111-vinohrady', name: '111. PTO Vinohrady' },
  { id: '8-mustangove', name: '8. PTO Mustangové' },
  { id: '11-iktomi', name: '11. PTO Iktomi' },
  { id: '15-vatra', name: '15. PTO Vatra' },
  { id: '41-dracata', name: '41. PTO Dráčata' },
  { id: '61-tuhas', name: '61. PTO Tuhas' },
  { id: '99-kamzici', name: '99. PTO Kamzíci' },
  { id: '172-pegas', name: '172. PTO Pegas' },
  { id: 'zabky-jedovnice', name: 'PTO Žabky Jedovnice' },
] as const;

const CURRENT_LEAGUE_SCORES: Record<string, Partial<Record<LeagueEvent, number>>> = {
  '63-phoenix': { 'pto-ob': 106 },
  '6-nibowaka': { 'pto-ob': 100 },
  '66-brabrouci': { 'pto-ob': 100 },
  'zs-pcv': { 'pto-ob': 100 },
  '10-severka': { 'pto-ob': 94 },
  '176-vlcata': { 'pto-ob': 94 },
  '34-tulak': { 'pto-ob': 94 },
  '21-hady': { 'pto-ob': 85 },
  '32-severka': { 'pto-ob': 79 },
  '64-lorien': { 'pto-ob': 71.5 },
  '48-stezka': { 'pto-ob': 29.5 },
  '2-poutnici': { 'pto-ob': 22 },
  '111-vinohrady': { 'pto-ob': 11.5 },
  '8-mustangove': { 'pto-ob': 0 },
  '11-iktomi': { 'pto-ob': 0 },
  '15-vatra': { 'pto-ob': 0 },
  '41-dracata': { 'pto-ob': 0 },
  '61-tuhas': { 'pto-ob': 0 },
  '99-kamzici': { 'pto-ob': 0 },
  '172-pegas': { 'pto-ob': 0 },
  'zabky-jedovnice': { 'pto-ob': 0 },
};

const HISTORICAL_LEAGUE_EMBED_URL =
  'https://docs.google.com/spreadsheets/d/14TLcdhZzW1jAgFk-eBWcOeh3uB8Ec2QewfNVjhefWJE/gviz/tq?tqx=out:html&gid=1022719772';

const SPTO_HISTORY_HIGHLIGHTS = [
  'Tábornické oddíly se v Brně začaly sdružovat v roce 1964.',
  'Inspiraci si vedoucí vzali v junáckých oddílech.',
  'Největší rozkvět nastal v letech 1967–1970.',
  'První náčelník Miloš Kyncl.',
];

const SPTO_FOUNDING_HIGHLIGHTS = [
  'SPTO bylo založeno v roce 1990.',
  'Nultý sněm SPTO se konal 13. 6. 1990.',
  'První ustanovující sněm SPTO se sešel 18. 9. 1990 na MěR Pionýra.',
  'Zakládajících oddílů bylo 38.',
  'V průběhu roku 1990 se do SPTO přihlásilo dalších 34 oddílů.',
];

const SPTO_FOUNDING_TROOPS = [
  '2. PTO Poutníci',
  '6. PTO Nibowaka',
  '10. PTO Severka',
  '32. PTO Severka',
  '48. PTO Stezka',
  '176. PTO Vlčata',
];

const SPTO_HONORARY_MEMBERS = [
  'Petr Bureš – dlouholetý vedoucí 48. PTO Stezka',
  'Jiří Mlaskač – George – hospodář sdružení',
];

const SPTO_CHIEFS = [
  { name: 'Miloš Kyncl', troop: '—', term: '1. náčelník SPTO (1969)' },
  { name: 'Luboš Pavlík', troop: '13. PTO Psohlavci', term: '1990–1993' },
  { name: 'Milan Appel', troop: '176. PTO Vlčata Bystrc', term: '1993–2003' },
  { name: 'Zdeněk Humpolík', troop: '21. PTO Cassiopea', term: '2003–2006' },
  { name: 'Michal Janík', troop: '27. PTO Lesní moudrost', term: '2006–2008' },
  { name: 'Bez náčelníka', troop: '—', term: '2008' },
  { name: 'Luboš Horký', troop: 'bez oddílové příslušnosti', term: '2008–2012' },
  { name: 'Petra Stolařová', troop: '32. PTO Severka', term: '2012–2016' },
  { name: 'Martin Hlavoň', troop: '26. PTO Kulturní historie', term: '2016–2018' },
  { name: 'Vítězslav Ondráček', troop: '10. PTO Severka', term: '2018–2022' },
  { name: 'René Hrabovský', troop: '64. PTO Lorien', term: '2022–dosud' },
];

const CAROUSEL_IMAGE_SOURCES = Object.entries(
  import.meta.glob('../assets/homepage-carousel/*.{jpg,jpeg,png,webp}', {
    eager: true,
    import: 'default',
  }),
)
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([, src]) => src as string);

type RuleFile = {
  filename: string;
  key: string;
  url: string;
};

const RULE_FILES: RuleFile[] = Object.entries(
  import.meta.glob('../assets/pravidla/*.pdf', {
    eager: true,
    import: 'default',
  }),
).map(([path, url]) => {
  const filename = path.split('/').pop() ?? '';
  const key = slugify(filename.replace(/\.pdf$/i, ''));
  return { filename, key, url: url as string };
});

const ABOUT_PDF_FILES: RuleFile[] = Object.entries(
  import.meta.glob('../assets/*.pdf', {
    eager: true,
    import: 'default',
  }),
).map(([path, url]) => {
  const filename = path.split('/').pop() ?? '';
  const key = slugify(filename.replace(/\.pdf$/i, ''));
  return { filename, key, url: url as string };
});

const SPTO_POLICY_PDF = ABOUT_PDF_FILES.find((file) => file.key.includes('zasady-cinnosti-spto')) ?? null;

const HOMEPAGE_CAROUSEL = (CAROUSEL_IMAGE_SOURCES.length ? CAROUSEL_IMAGE_SOURCES : [logo, logo, logo]).map(
  (src, index) => ({
    id: `carousel-${index + 1}`,
    src,
    alt: 'Fotka z akcí SPTO',
  }),
);

const GALLERY_PAGE_SIZE = 24;

type Article = {
  title: string;
  dateLabel: string;
  dateISO: string;
  excerpt: string;
  href: string;
  body: string[] | any[] | string | null;
  bodyFormat?: 'html' | 'text' | null;
  author?: string;
  coverImage?: { url: string; alt?: string | null } | null;
};

type CarouselImage = {
  id: string;
  src: string;
  alt: string;
};

const TROOP_LOGO_SOURCES = Object.entries(
  import.meta.glob('../assets/oddily/*.{png,jpg,jpeg,webp,svg}', {
    eager: true,
    import: 'default',
  }),
).reduce<Record<string, string>>((acc, [path, src]) => {
  const fileName = path.split('/').pop();
  if (!fileName) {
    return acc;
  }
  const key = fileName.split('.')[0]?.toLowerCase();
  if (key) {
    acc[key] = src as string;
  }
  return acc;
}, {});

type DriveAlbum = {
  id: string;
  title: string;
  year: string;
  slug: string;
  folderId: string;
};

type GalleryPhoto = {
  fileId: string;
  name: string;
  thumbnailLink: string | null;
  fullImageUrl: string | null;
  webContentLink: string | null;
};

type GalleryPreview = {
  files: GalleryPhoto[];
  totalCount: number | null;
};

const ARTICLES: Article[] = [
  {
    title: 'Setonův závod',
    dateLabel: '06. 05. 2025',
    dateISO: '2025-05-06',
    excerpt: '33. ročník tradiční závěrečné soutěže Zelené ligy se konal v Řečkovicích.',
    href: '/clanky/setonuv-zavod-2025',
    body: [
      'V sobotu 26. 4. 2025 se uskutečnil 33. ročník Setonova závodu, tradiční závěrečné soutěže Zelené ligy (celoroční soutěž mezi brněnskými pionýrskými tábornickými oddíly sdruženými v SPTO). Tentokrát se závod konal v Zamilovaném hájku v Řečkovicích a jeho okolí.',
      'Jde o tábornicko-branný závod tříčlenných týmů (hlídek). Hlídky soutěží ve čtyřech věkových kategoriích, které se dělí na hochy a dívky. Tento rok Setonův závod pořádal 10. PTO Severka.',
      'Hlídky běžely trasu o délce mezi 6 a 12 kilometry v závislosti na věkové kategorii. Trať vedla lesními cestami mezi Řečkovicemi, Soběšicemi a Mokrou Horou. Během závodu hlídky postupně plnily úkoly na stanovištích, například poznávání rostlin a zvířat, stavbu stanu, střelbu z foukaček, práci s mapou a buzolou či první pomoc a zdravovědu. Úkolem hlídek bylo získat na každém stanovišti co nejvíce z 12 možných bodů a současně dokončit závod v co nejkratším čase.',
      'Závod začal ráno od 8 hodin, kdy na trať vyrazily první hlídky. Na trať vyběhlo celkem 98 hlídek ze 17 pionýrských oddílů. Mezi jedenáctou a dvanáctou hodinou na startovní louce zavládl klid, když na ní zůstali jen vedoucí doprovázející hlídky a organizátoři akce. To se však po dvanácté hodině začalo měnit, když dobíhaly první hlídky. Na ty v cíli čekal oběd (hotdog) a také napínavé čekání, na jak dobré umístění bude jejich výkon v závodě stačit.',
      'Po páté odpolední hodině se všem hlídkám podařilo úspěšně najít cestu zpátky do cíle a mohlo tak začít vyhlášování výsledků a udílení cen a diplomů. Nejlépe si vedl 63. PTO Phoenix, jehož hlídky vyhrály hned ve čtyřech kategoriích a získaly tak i putovní ceny pro jednotlivé kategorie. Jedno vítězství si pak na své konto připsaly 10. PTO Severka, 64. PTO Lorien, 176. PTO Vlčata a smíšená hlídka 24. PTO Života v přírodě a 27. PTO Lesní moudrosti. Po vyhlášení se zúčastněné oddíly vydaly zpátky domů.',
      'Celkem se závodu zúčastnilo 293 dětí. 90 vedoucích poté zajišťovalo provoz 16 soutěžních stanovišť a o hladký průběh akce se staralo přes 25 organizátorů. Další vedoucí poté přišli fandit svým dětem na startovní louku. Za organizátory doufám, že si všichni zúčastnění akci užili a děkuji všem za jejich účast.',
    ],
    author: 'Martin, 10. PTO Severka',
  },
  {
    title: 'Memoriál Bedřicha Stoličky',
    dateLabel: '05. 10. 2024',
    dateISO: '2024-10-05',
    excerpt: 'První akce Zelené ligy školního roku přinesla sportovní okruhy i slavnostní ceremoniál.',
    href: '/clanky/memorial-bedricha-stolicky-2024',
    body: [
      'V sobotu 5. 10. 2024 jsme se společně sešli na základní škole v Líšni, abychom se zúčastnili první akce Zelené ligy tohoto školního roku, a to Memoriálu Bedřicha Stoličky. Jednalo se sportovní soutěž, kde se děti mohly vyzkoušet různé sportovní a olympijské disciplíny. Celý závod byl rozdělen na tři okruhy - okruh atletických, silových a mrštnostních disciplín. Každý závodník se musel přihlásit na dva okruhy, z nichž jeden musel být atletika. Letos soutěž pořádal oddíl 21. PTO Hády. Celkově se zaregistrovalo a závodilo 230 dětí.',
      'Celá akce začala slavnostním zahajovacím ceremoniálem, kde za každý oddíl byli vysláni dva zástupci s transparentem, aby v kostýmu reprezentovali svůj oddíl. Při ceremoniálu byl i slavnostně zapálen oheň, a tím mohl celý den odstartovat. Děti byly rozděleny do 12 různých kategorií dle věku a pohlaví a podle těchto kategorií obcházely celý den jednotlivé disciplíny – některé probíhaly venku, některé vevnitř v tělocvičnách. Dopoledne probíhal okruh atletických disciplín, kde závodníci soupeřili v běhu, skoku do dálky, hodu krikeťákem či koulí, šplhu na tyči a ve střelbě z flusačky. Po absolvování atletického okruhu následovala krátká obědová pauza, a poté si závodníci dle výběru obešli disciplíny silové (zdvih medicimbalu, výskok na bednu a sedy lehy) nebo disciplíny mrštnostní (přeskok přes lavičku, leh-stoj a švihadlo). Na závěr probíhala ještě nesoutěžní štafeta ve třech různých kategoriích dle věku, které se mohli účastnit i závodníci kategorie Old. Celý den byl zakončen vyhlášením, kde si nejlepší závodníci mohli stoupnout na stupně vítězů a obdrželi medaile za krásné sportovní výkony. Všichni účastníci i přes nepříznivé počasí a občasný déšť zvládli absolvovat všechny disciplíny a my doufáme, že si všichni tuto akci užili.',
    ],
  },
  {
    title: 'Sraz PTO',
    dateLabel: '04. 06. 2024',
    dateISO: '2024-06-04',
    excerpt: 'Pravěká víkendová akce na tábořišti Krkatá bába nabídla soutěže, guláše i slavnostní oheň.',
    href: '/clanky/sraz-pto-2024',
    body: [
      'Jako již tradičně každý rok v květnu se velká část pionýrských tábornických oddílů sjela na víkendovou akci zvanou Sraz PTO. Akci, která má za hlavní cíl potkat se s ostatními oddíly SPTO, užít si společně strávený čas a zahrát si hry s ostatními dětmi z dalších oddílů. Je krásné vědět, že je nás opravdu hodně a kolik nadšených dětí Pionýr sdružuje. Letos se sjelo necelých 230 účastníků, z toho 140 dětí do 15 let, což je krásná účast na to, jaká předpověď počasí na tento víkend vyšla.',
      'Sraz se konal na tábořišti Krkatá bába nedaleko vesnice Lubě. Tábořiště je naprosto kouzelné, uprostřed lesů a krásného potoka, takže jsme se všichni naplno ponořili do klidu přírody. Letošní celovíkendovou motivací byl pravěk, tudíž se všechno neslo v tomto duchu.',
      'V pátek odpoledne a v podvečer se sjížděly všechny oddíly, kterých nakonec bylo celkem 13 a i přes těžce sjízdnou příjezdovou cestu nikdo ani nezapadl ani se neutopil v brodu, což považujeme za první úspěch. Všechny oddíly postavily svá obydlí, rozdělaly ohně a začaly vařit večeři. Celý večer se nesl v poklidu, seznamování, povídání si a kamarádství.',
      'Sobota byla hlavním dnem veškerých připravených aktivit. Ráno všichni vstali, některé odvážnější oddíly provedly ranní rozcvičku, pak už všichni po oddílech snídali a připravovali se na dopolední program. Kdo měl, převlékl se do svého pravěkého kostýmu a je třeba podotknout, že jich bylo skutečně hodně a byly velice zdařilé! Následoval nástup, kde se všichni dozvěděli, jaké dopolední aktivity nás čekají a následně se všichni rozeběhli po stanovištích a plnili všelijaké úkoly. Každý oddíl si připravil nějaký úkol, soutěž, hlavolam a pokud jej děti splnily, dostaly od vedoucího přívěsek dřevěné kosti s vygravírovaným znakem daného oddílu. Mezi soutěžemi byl například lov mamuta foukačkou, lov mamuta oštěpem, souboj s lukem a šípy, malování jeskynních maleb nebo silový zápas. Úlohy byly pestré a všichni si je náramně užívali.',
      'Paralelně s těmito aktivitami probíhala soutěž o nejlepší kotlíkový guláš. Zapojilo se 10 oddílů a styly gulášů byly různé. Od tradičního hovězího, přes segedínský či guláš s domácím karlovarským knedlíkem až po pořádné buřtguláše. Cenu za nejlepší guláš si po těsném souboji odnesly oddíly Mustangové a Vlčata. Zároveň po tábořišti procházeli čtyři staří šamani, kteří hledali nové členy do své tlupy na odpolední souboj. Každého vybraného člena označili specifickými malbami na obličej určité barvy.',
      'Při ochutnávání guláše začala první silná průtrž mračen s kroupami, která prověřila odolnost naši i našich stanů. Naštěstí všechno vydrželo a polední klid jsme si užili i s trochou sluníčka.',
      'Odpoledne následoval velký souboj, kdy se proti sobě postavily čtyři kmeny, které obsazovaly území pomocí barevných kamínků. Zároveň probíhal boj mezi členy pomocí kyjů, jak se na pořádnou pravěkou pranici patří.',
      'Těsně ke konci hry začalo opět pršet, tak až se všichni vrátili, dali jsme mokré boty sušit ke kamnům, aby bylo všem dobře.',
      'Po večeři už nás čekal pouze slavnostní oheň, který celou sobotu krásně zakončil. I když byly ze začátku problémy se zapálením pro vlhkost dříví, nakonec se pomocí suchých třísek podařilo a mohli jsme si užít společný večer s kytarami. Těch se letos sešlo skutečně hodně, dále také cajon a ukulele, takže to vypadalo jako na malém koncertu. Zpívání písniček bylo prokládáno drobnými soutěžemi mezi oddíly jako bylo balancování kyje nebo pinkání balonu. Kolem 10. hodiny večer jsme zahráli několik ukolébavek a byl čas jít spát.',
      'Neděle patřila zakončení celého víkendu. Proběhl slavnostní krojovaný nástup, na kterém byli představeni noví instruktoři z loňského podzimního a letošního jarního instruktoráku, byla jim předána osvědčení a sklidili zasloužený potlesk. Následovalo tradiční vyhodnocení Zelené ligy, kterou v letošním roce ovládly oddíly 10. PTO Severka a 63. PTO Phoenix se stejným počtem bodů, což se zatím nikdy nestalo, a my jim gratulujeme. Stezka předala PTO prapor oddílu Hády, kteří pro nás připravují podzimní soutěž Memoriál Bedřicha Stoličky a už nyní se na to můžeme těšit.',
      'Po nástupu a obědě proběhlo balení všech věcí, úklid tábořiště a postupný odjezd domů. Moc děkujeme všem zúčastněným oddílům za to, že vydržely až do konce i přes nepřízeň počasí, že se hrdě pustily do gulášové soutěže a že pro děti připravily úžasné dopolední aktivity. Věříme, že jste si celý víkend užili stejně jako my a těšíme se, až se potkáme na další povedené akci co nejdříve.',
    ],
    author: 'Martin (Chemik) Zapletal',
  },
  {
    title: 'Setonův závod 27. 4. 2024',
    dateLabel: '07. 05. 2024',
    dateISO: '2024-05-07',
    excerpt: '32. ročník závodu v lesích mezi Soběšicemi a Útěchovem přinesl 322 závodníků.',
    href: '/clanky/setonuv-zavod-2024',
    body: [
      'V sobotu 27. 4. 2024 se uskutečnil 32. ročník Setonova závodu. Tentokrát v lesích U Jezírka mezi Soběšicemi a Útěchovem. Jedná se o tábornicko-branný závod tříčlenných dětských skupin, takzvaných hlídek, jenž každoročně pořádají oddíly ze Sdružení Pionýrských Tábornických Oddílů (SPTO). Letos jej pořádal oddíl 63. PTO Phoenix. Každý rok se závodu účastní 15-20 pionýrských oddílů z Brna a okolí.',
      'Hlídky běžely trasu o délce mezi 6 a 12 kilometry, v závislosti na tom, do které ze 4 věkových kategorií spadaly. Trať vedla lesními cestami mezi Soběšicemi, Útěchovem a Ořechovem. Během závodu hlídky postupně plnily úkoly na stanovištích, například poznávání rostlin a zvířat, stavbu stanu, střelbu z foukaček, práci s mapou a buzolou či první pomoc a zdravovědu. Úkolem hlídek bylo získat na každém stanovišti co nejvíce z 12 možných bodů a současně dokončit závod v co nejkratším čase.',
      'Závod začal po osmé hodině ranní, kdy na louku U Jezírka dorazily první oddíly. Ty si zaregistrovaly svoje děti do závodu, postavily na louce stany jako své zázemí a odstartovaly své děti do závodu. Toto postupně absolvovaly i další příchozí oddíly, až do jedenácté hodiny, kdy na trať vyběhly poslední hlídky. Na startovní louce poté nastala chvíle podivného klidu, kdy na této dětské akci najednou nebyly k vidění žádné děti. Což se ovšem záhy změnilo, když se první děti začaly vracet z trati, už kolem dvanácté hodiny. Tím už pro ně závod skončil a mohly si v klidu odpočinout a pochutnat si na výtečném obědě, který pro ně připravil náš kuchařský tým Gastrochef.',
      'Letos jsme měli zajímavou novinku, pro zkrácení dlouhé chvíle čekajícím dětem. Vedoucí ze Zeměpisné společnosti si pro děti připravili ukázku archeologické práce. Děti si tak mohly vyzkoušel práci s detektorem kovů, vykopávání a očišťování předmětů a také si pohrát s historickými zbrojemi a meči.',
      'Poslední hlídky dorazily do cíle ve 4 hodiny odpoledne. V ten okamžik již byly kostky vrženy a nezbývalo než čekat, jak to letos dopadne. Vyhlášení začalo ani ne hodinu poté. Zde se všechny oddíly shromáždily ke slavnostnímu nástupu a vyslechly si vyhlášení nejlepších hlídek v celkem 8 kategoriích – 4 věkových, dále rozdělených na hochy a dívky. Několik nejlepších hlídek z každé kategorie si, za hlasitého potlesku, přebralo diplomy a věcné ceny. Vítězné hlídky každé kategorie navíc ještě získaly do svého oddílu putovní ceny. Takto si na 5 putovních cen přišel 63. PTO Phoenix a po jedné putovní ceně 10. PTO Severka, 32. PTO Severka a 64. PTO Lorien.',
      'Ukončením slavnostního nástupu skončil i závod. Celkem se jej letos zúčastnilo 322 závodníků a dalších 88 vedoucích z různých oddílů pro ně připravilo celkem 18 soutěžních stanovišť. Celý den nám naštěstí přálo počasí. Bylo jasno, na nebi se jen zřídkakdy objevil mráček a ač bylo teplo, nebylo to úmorné vedro, které by zavánělo úpalem. Ve spojení s občasným vánkem to bylo to nejlepší počasí, co jsme si mohli přát.',
      'My organizátoři to vnímáme jako povedený závod a doufáme, že jej stejně vnímali i všichni zúčastnění.',
    ],
  },
];

// TODO: Napojit na API / Supabase pro reálné pořadí Zelené ligy.

// Fotogalerie je napojená na Google Drive přes service account.
// Root složka sdílená na e-mail service accountu, ENV:
// - GOOGLE_SERVICE_ACCOUNT_EMAIL
// - GOOGLE_PRIVATE_KEY
// - GOOGLE_DRIVE_ROOT_FOLDER_ID
type Troop = {
  number: string;
  name: string;
  year?: string;
  leader: string;
  href: string;
  description?: string[];
  website?: string;
  logoKey?: string;
};

const TROOPS: Troop[] = [
  {
    number: '2',
    name: 'Poutníci',
    year: '1987',
    leader: 'Jan Dalecký',
    href: '/oddily/2-poutnici',
    website: 'https://poutnici.org/',
  },
  {
    number: '6',
    name: 'Nibowaka',
    year: '1982',
    leader: 'Tomáš Hála',
    href: '/oddily/6-nibowaka',
    website: 'https://www.nibowaka.cz/',
  },
  {
    number: '10',
    name: 'Severka',
    year: '1984',
    leader: 'Ondřej Uldrijan',
    href: '/oddily/10-severka',
    website: 'https://www.severka.cz/',
  },
  {
    number: '11',
    name: 'Iktomi',
    year: '2013',
    leader: 'Linda Rahelová (Ovce)',
    href: '/oddily/11-iktomi',
    website: 'https://www.vlcibrno.cz/',
  },
  {
    number: '15',
    name: 'Vatra',
    year: '1975',
    leader: 'Luděk Maar',
    href: '/oddily/15-vatra',
    website: 'https://www.vatra.pionyr.cz/',
  },
  {
    number: '21',
    name: 'Hády',
    year: '1983',
    leader: 'Alena Nekvapilova',
    href: '/oddily/21-hady',
    website: 'https://www.pshady.cz/',
  },
  {
    number: '',
    name: 'ZS PCV',
    year: '1972',
    leader: 'Matouš Procházka',
    href: '/oddily/zs-pcv',
    website: 'https://www.zeeska.cz/',
    logoKey: 'zspcv',
  },
  {
    number: '32',
    name: 'Severka',
    year: '1985',
    leader: 'Ondřej Ševčík (Ševa)',
    href: '/oddily/32-severka',
    website: 'https://severka.org/',
    description: [
      'Náš oddíl se jmenuje Severka a pocházíme z brněnských Bohunic. Posláním našeho oddílu je poskytovat dětem zázemí, ve kterém jsou vychovávány ve vztahu k přírodě, kamarádům i sobě samým. Učíme je být samostatnými, posouváme hranice jejich možností. Děláme to z přesvědčení, že jim to pomůže při další cestě životem. Často vyrážíme do přírody za dobrodružstvím a to vše v partě přátel a kamarádů.',
      'Náš oddíl má mnoholetou tradici – založení oddílu 1. 5. 1985. Je zaměřený na turistiku, pobyt v přírodě i ve městě, tábornictví, sportovní hry a vodáctví, ale provozujeme také jiné činnosti jako je zpívání, rukodělná a řemeslná výroba, výlety na kolech a koních, návštěvy jeskyní, horolezectví, lyžování, plavání atd.',
      'Potkáváme se na každotýdenních schůzkách, jednodenních výletech i víkendových výpravách a samozřejmě letním stanovém táboru. Každoročně pořádáme také akce pro děti s rodiči, příměstské tábory, letní expedice, sjíždění řek či výlety do zahraničí. Pravidelně se také účastníme různých soutěží a můžeme se pochlubit například několika prvními místy na republikovém finále závodů tábornických dovedností.',
      'V současné době se náš oddíl skládá přibližně z šedesáti dětí, rádců a vedoucích. Věkové složení dětí je od šesti do šestnácti let.',
    ],
  },
  {
    number: '34',
    name: 'Tulák',
    year: '1981',
    leader: 'František Reitter',
    href: '/oddily/34-tulak',
    website: 'https://www.tulak.org/',
  },
  {
    number: '41',
    name: 'Dráčata',
    year: '1992',
    leader: 'Ing. Jaroslav Pipota',
    href: '/oddily/41-dracata',
    website: 'https://dracata-brno.cz/',
  },
  {
    number: '48',
    name: 'Stezka',
    year: '1983',
    leader: 'Tomáš Vondrák (Zuby)',
    href: '/oddily/48-stezka',
    website: 'https://stezka.org/',
  },
  {
    number: '63',
    name: 'Phoenix',
    year: '1992',
    leader: 'Roman Valenta (Rogi)',
    href: '/oddily/63-phoenix',
    website: 'https://63ptophoenix.cz/',
  },
  {
    number: '64',
    name: 'Lorien',
    year: '1996',
    leader: 'René Hrabovský (Renda)',
    href: '/oddily/64-lorien',
    website: 'https://www.pto-lorien.cz/home/',
  },
  {
    number: '66',
    name: 'Brabrouci Modřice',
    year: '1998',
    leader: 'Veronika Obdržálková (Špion)',
    href: '/oddily/66-brabrouci-modrice',
    website: 'https://brabrouci.cz/',
  },
  {
    number: '99',
    name: 'Kamzíci',
    leader: 'Radek Slavík (Bambus)',
    href: '/oddily/99-kamzici',
    website: 'https://www.facebook.com/Kamzici/?locale=cs_CZ',
  },
  {
    number: '111',
    name: 'Vinohrady',
    year: '1990',
    leader: 'Radek Zeman',
    href: '/oddily/111-vinohrady',
    website: 'https://www.psvinohrady.cz/',
  },
  {
    number: '172',
    name: 'Pegas',
    year: '1993',
    leader: 'Michal Kubeš (Pat)',
    href: '/oddily/172-pegas',
  },
  {
    number: '176',
    name: 'Vlčata',
    year: '1971',
    leader: 'Jakub Nejezchleba (Boris)',
    href: '/oddily/176-vlcata',
    website: 'https://www.vlcata.cz/',
  },
  {
    number: 'x',
    name: 'Žabky',
    year: '1993',
    leader: 'Pavlína Héčová (Spajdik)',
    href: '/oddily/x-zabky',
    website: 'https://pionyr.jedovnice.cz/',
    logoKey: 'zabky',
  },
];

const HEADER_SUBTITLE = 'Soutěže, oddíly a informace na jednom místě.';

const APPLICATION_LINKS = [
  {
    label: 'Setonův závod – aplikace',
    description: 'Hlavní rozhraní pro sběr bodů a správu stanovišť.',
    href: '/aplikace/setonuv-zavod',
  },
];

const CONTACTS = [
  {
    role: 'Načelník SPTO',
    name: 'René Hrabovský (Renda)',
    phone: '+420 604 208 908',
    email: 'ReneHrabovsky@seznam.cz',
  },
  {
    role: 'Sekretářka SPTO',
    name: 'Roman Valenta (Rogi)',
    phone: '+420 720 114 501',
    email: 'rogis@seznam.cz',
  },
  {
    role: 'Správce webu',
    name: 'Ondřej Ševčík (Ševa)',
    phone: '+420 731 019 469',
    email: 'osevcik@severka.org',
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

function formatRuleLabel(filename: string): string {
  return filename.replace(/\.pdf$/i, '').replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
}

function getCompetitionRules(competition: Competition): RuleFile[] {
  if (!competition.ruleMatchers.length) {
    return [];
  }
  return RULE_FILES.filter((rule) =>
    competition.ruleMatchers.some((matcher) => rule.key.includes(matcher)),
  ).sort((a, b) => a.filename.localeCompare(b.filename, 'cs'));
}

function formatDateLabel(dateISO: string) {
  const date = new Date(dateISO);
  if (Number.isNaN(date.getTime())) {
    return dateISO;
  }
  return date.toLocaleDateString('cs-CZ', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function toDriveSizedUrl(url: string, size: number) {
  let output = url.replace(/=s\d+(-c)?/g, `=w${size}`);
  output = output.replace(/=w\d+-h\d+(-c)?/g, `=w${size}`);
  return output;
}

function getPhotoThumbUrl(photo: GalleryPhoto | undefined | null, size: number) {
  if (!photo) {
    return '';
  }
  if (photo.thumbnailLink) {
    return toDriveSizedUrl(photo.thumbnailLink, size);
  }
  return photo.fullImageUrl ?? photo.webContentLink ?? '';
}

const portableTextComponents = {
  types: {
    image: ({ value }: { value: { asset?: { url?: string }; alt?: string } }) => {
      const src = value?.asset?.url;
      if (!src) {
        return null;
      }
      return <img src={src} alt={value.alt ?? ''} loading="lazy" />;
    },
  },
};

function mapContentArticle(article: ContentArticle): Article {
  const dateISO = article.dateISO;
  const coverImage =
    article.coverImage?.url ? { url: article.coverImage.url, alt: article.coverImage.alt ?? null } : undefined;
  return {
    title: article.title,
    dateISO,
    dateLabel: formatDateLabel(dateISO),
    excerpt: article.excerpt ?? '',
    href: `/clanky/${article.slug}`,
    body: article.body ?? null,
    bodyFormat: article.bodyFormat ?? null,
    author: article.author ?? undefined,
    coverImage,
  };
}

async function fetchAlbumPreview(folderId: string): Promise<GalleryPreview> {
  const params = new URLSearchParams({
    folderId,
    pageSize: '4',
    includeCount: '1',
    includeSubfolders: '1',
  });
  const response = await fetch(`/api/gallery/album?${params.toString()}`);
  if (!response.ok) {
    throw new Error('Failed to load album preview.');
  }
  return response.json();
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
  listClassName,
}: {
  eyebrow?: string;
  title: string;
  lead: string;
  links?: InfoLink[];
  backHref?: string;
  listClassName?: string;
}) {
  return (
    <SiteShell>
      <main className="homepage-main homepage-single" aria-labelledby="info-heading">
        {eyebrow ? <p className="homepage-eyebrow">{eyebrow}</p> : null}
        <h1 id="info-heading">{title}</h1>
        <p className="homepage-lead">{lead}</p>
        <div className="homepage-card">
          {links && links.length > 0 ? (
            <ul className={listClassName ? `homepage-list ${listClassName}` : 'homepage-list'}>
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

function PdfEmbedCard({ title, url }: { title: string; url: string }) {
  const isMobile = typeof window !== 'undefined' && window.matchMedia('(max-width: 900px)').matches;
  const zoom = isMobile ? 140 : 120;
  const pdfUrl = `${url}#view=FitH&zoom=${zoom}&toolbar=1&navpanes=0&scrollbar=1`;

  return (
    <div className="homepage-pdf-card">
      <div className="homepage-pdf-frame">
        <iframe src={pdfUrl} title={title} loading="lazy" allowFullScreen scrolling="yes" />
      </div>
      <div className="homepage-pdf-footer">
        <span className="homepage-pdf-title">{title}</span>
        <a className="homepage-cta secondary homepage-pdf-open" href={url} target="_blank" rel="noreferrer">
          Otevřít PDF
        </a>
        <a className="homepage-cta secondary homepage-pdf-download" href={url} download>
          Stáhnout
        </a>
      </div>
      {isMobile ? (
        <p className="homepage-pdf-note">
          Na telefonu doporučujeme PDF otevřít na celou obrazovku – bude se lépe listovat.
        </p>
      ) : null}
    </div>
  );
}

function TroopsPage() {
  return (
    <SiteShell>
      <main className="homepage-main homepage-single troops-page" aria-labelledby="troops-heading">
        <p className="homepage-eyebrow">SPTO · Oddíly</p>
        <h1 id="troops-heading">Oddíly SPTO</h1>
        <p className="homepage-lead">Seznam oddílů zapojených do pionýrského tábornictví.</p>
        <div className="homepage-card">
          <div className="troops-grid">
            {TROOPS.map((troop) => {
              const logo = resolveTroopLogo(troop);
              return (
                <div key={troop.href} className="troop-card">
                  <a className="troop-card-main" href={troop.href}>
                    <div className="troop-logo">
                      {logo ? <img src={logo} alt={`Logo ${formatTroopName(troop)}`} loading="lazy" /> : null}
                    </div>
                    <div className="troop-card-content">
                      <strong>{formatTroopName(troop)}</strong>
                      <span>{formatTroopDescription(troop)}</span>
                    </div>
                  </a>
                  {troop.website ? (
                    <a className="troop-website-link" href={troop.website} target="_blank" rel="noreferrer">
                      Web oddílu
                    </a>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
        <a className="homepage-back-link" href="/">
          Zpět na hlavní stránku
        </a>
      </main>
    </SiteShell>
  );
}

function TroopDetailPage({ troop }: { troop: Troop }) {
  const detailParts = [];
  if (troop.year) {
    detailParts.push(`založeno ${troop.year}`);
  }
  if (troop.leader) {
    detailParts.push(`vedoucí ${troop.leader}`);
  }
  const logo = resolveTroopLogo(troop);
  return (
    <SiteShell>
      <main className="homepage-main homepage-single troop-detail" aria-labelledby="troop-heading">
        <p className="homepage-eyebrow">SPTO · Oddíly</p>
        <h1 id="troop-heading">{formatTroopName(troop)}</h1>
        <p className="homepage-lead">{detailParts.join(' · ')}</p>
        <div className="homepage-card troop-detail-card">
          {logo ? (
            troop.website ? (
              <a className="troop-detail-logo-link" href={troop.website} target="_blank" rel="noreferrer">
                <img className="troop-detail-logo" src={logo} alt={`Logo ${formatTroopName(troop)}`} />
              </a>
            ) : (
              <img className="troop-detail-logo" src={logo} alt={`Logo ${formatTroopName(troop)}`} />
            )
          ) : null}
          {troop.description && troop.description.length > 0 ? (
            <div className="troop-detail-copy">
              {troop.description.map((paragraph, index) => (
                <p key={`${troop.href}-desc-${index}`}>{paragraph}</p>
              ))}
            </div>
          ) : null}
        </div>
        <a className="homepage-back-link" href="/oddily">
          Zpět na seznam oddílů
        </a>
      </main>
    </SiteShell>
  );
}

function ContactsPage() {
  const toTelHref = (phone: string) => `tel:${phone.replace(/[^\d+]/g, '')}`;

  return (
    <SiteShell>
      <main className="homepage-main homepage-single contacts-page" aria-labelledby="contacts-heading">
        <p className="homepage-eyebrow">SPTO · Kontakty</p>
        <h1 id="contacts-heading">Kontakty</h1>
        <p className="homepage-lead">Rádi poradíme s činností oddílů i s organizací soutěží.</p>
        <div className="homepage-card">
          <div className="contacts-grid">
            {CONTACTS.map((contact) => (
              <div key={contact.role} className="contact-card">
                <div className="contact-card-header">
                  <strong>{contact.role}</strong>
                  <span>{contact.name}</span>
                </div>
                <div className="contact-card-meta">
                  <span>
                    Telefon:{' '}
                    <a href={toTelHref(contact.phone)} className="contact-card-link">
                      {contact.phone}
                    </a>
                  </span>
                  <span>
                    E-mail:{' '}
                    <a href={`mailto:${contact.email}`} className="contact-card-link">
                      {contact.email}
                    </a>
                  </span>
                </div>
              </div>
            ))}
          </div>
          <div className="contacts-extra">
            <a
              className="homepage-cta secondary"
              href="https://drive.google.com/drive/u/2/folders/1i10O0d2Z5fW-bI1U6ZzW6KjuhcdwIk3N"
              target="_blank"
              rel="noreferrer"
            >
              Google Drive SPTO
            </a>
          </div>
        </div>
        <a className="homepage-back-link" href="/">
          Zpět na hlavní stránku
        </a>
      </main>
    </SiteShell>
  );
}

function ArticlePage({ article }: { article: Article }) {
  const isPortableText = Array.isArray(article.body) && typeof article.body[0] === 'object';
  const isHtmlBody =
    article.bodyFormat === 'html' ||
    (typeof article.body === 'string' && article.body.trim().startsWith('<'));
  const textParagraphs =
    typeof article.body === 'string' && !isHtmlBody
      ? article.body
          .split(/\n{2,}/)
          .map((paragraph) => paragraph.trim())
          .filter(Boolean)
      : [];
  return (
    <SiteShell>
      <main className="homepage-main homepage-single" aria-labelledby="article-heading">
        <p className="homepage-eyebrow">SPTO · Článek</p>
        <h1 id="article-heading">{article.title}</h1>
        <p className="homepage-lead">
          {article.dateLabel} · {article.excerpt}
        </p>
        <div className="homepage-card">
          {article.coverImage?.url ? (
            <img
              className="homepage-article-cover"
              src={article.coverImage.url}
              alt={article.coverImage.alt ?? ''}
              loading="lazy"
            />
          ) : null}
          {isPortableText ? (
            <PortableText value={article.body as any[]} components={portableTextComponents} />
          ) : isHtmlBody && typeof article.body === 'string' ? (
            <div className="homepage-article-html" dangerouslySetInnerHTML={{ __html: article.body }} />
          ) : textParagraphs.length > 0 ? (
            textParagraphs.map((paragraph, index) => <p key={`${article.href}-${index}`}>{paragraph}</p>)
          ) : Array.isArray(article.body) ? (
            (article.body as string[]).map((paragraph, index) => (
              <p key={`${article.href}-${index}`}>{paragraph}</p>
            ))
          ) : null}
          {article.author ? (
            <p style={{ marginTop: '24px', fontWeight: 600 }}>{article.author}</p>
          ) : null}
        </div>
        <a className="homepage-back-link" href="/clanky">
          Zpět na seznam článků
        </a>
      </main>
    </SiteShell>
  );
}

type EditorArticle = {
  id: string;
  slug: string;
  title: string;
  excerpt?: string | null;
  body?: string | null;
  author?: string | null;
  cover_image_url?: string | null;
  cover_image_alt?: string | null;
  status: 'draft' | 'published';
  published_at?: string | null;
  created_at?: string | null;
};

type EditorFormState = {
  title: string;
  slug: string;
  excerpt: string;
  body: string;
  author: string;
  cover_image_url: string;
  cover_image_alt: string;
  status: 'draft' | 'published';
};

const EMPTY_EDITOR_FORM: EditorFormState = {
  title: '',
  slug: '',
  excerpt: '',
  body: '',
  author: '',
  cover_image_url: '',
  cover_image_alt: '',
  status: 'draft',
};

function RedakcePage() {
  const [session, setSession] = useState<'checking' | 'unauth' | 'auth'>('checking');
  const [password, setPassword] = useState('');
  const [articles, setArticles] = useState<EditorArticle[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [form, setForm] = useState<EditorFormState>(EMPTY_EDITOR_FORM);
  const [message, setMessage] = useState<string | null>(null);

  const loadArticles = () =>
    fetch('/api/content/admin/articles', { credentials: 'include' })
      .then((response) => (response.ok ? response.json() : Promise.reject()))
      .then((data) => {
        setArticles(data.articles ?? []);
      })
      .catch(() => {
        setArticles([]);
      });

  useEffect(() => {
    let active = true;
    fetch('/api/content/admin/session', { credentials: 'include' })
      .then((response) => {
        if (!active) return;
        setSession(response.ok ? 'auth' : 'unauth');
        if (response.ok) {
          loadArticles();
        }
      })
      .catch(() => {
        if (active) {
          setSession('unauth');
        }
      });
    return () => {
      active = false;
    };
  }, []);

  const handleLogin = (event: React.FormEvent) => {
    event.preventDefault();
    setMessage(null);
    fetch('/api/content/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ password }),
    })
      .then((response) => {
        if (!response.ok) {
          throw new Error('Neplatné heslo.');
        }
        setSession('auth');
        setPassword('');
        return loadArticles();
      })
      .catch((error) => {
        setMessage(error instanceof Error ? error.message : 'Přihlášení se nezdařilo.');
      });
  };

  const handleLogout = () => {
    fetch('/api/content/admin/logout', {
      method: 'POST',
      credentials: 'include',
    }).finally(() => {
      setSession('unauth');
      setArticles([]);
      setActiveId(null);
      setForm(EMPTY_EDITOR_FORM);
    });
  };

  const selectArticle = (article: EditorArticle) => {
    setActiveId(article.id);
    setForm({
      title: article.title ?? '',
      slug: article.slug ?? '',
      excerpt: article.excerpt ?? '',
      body: article.body ?? '',
      author: article.author ?? '',
      cover_image_url: article.cover_image_url ?? '',
      cover_image_alt: article.cover_image_alt ?? '',
      status: article.status ?? 'draft',
    });
    setMessage(null);
  };

  const handleNew = () => {
    setActiveId(null);
    setForm(EMPTY_EDITOR_FORM);
    setMessage(null);
  };

  const handleSave = () => {
    setMessage(null);
    const payload = {
      title: form.title.trim(),
      slug: form.slug.trim() || slugify(form.title),
      excerpt: form.excerpt,
      body: form.body,
      author: form.author,
      cover_image_url: form.cover_image_url,
      cover_image_alt: form.cover_image_alt,
      status: form.status,
    };
    const method = activeId ? 'PUT' : 'POST';
    const url = activeId ? `/api/content/admin/articles/${activeId}` : '/api/content/admin/articles';
    fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(payload),
    })
      .then((response) => (response.ok ? response.json() : Promise.reject()))
      .then((data) => {
        setMessage('Uloženo.');
        if (data.article?.id) {
          setActiveId(data.article.id);
        }
        loadArticles();
      })
      .catch(() => {
        setMessage('Uložení se nezdařilo.');
      });
  };

  const handleDelete = () => {
    if (!activeId) return;
    if (!confirm('Opravdu smazat článek?')) {
      return;
    }
    fetch(`/api/content/admin/articles/${activeId}`, {
      method: 'DELETE',
      credentials: 'include',
    })
      .then(() => {
        setMessage('Článek smazán.');
        handleNew();
        loadArticles();
      })
      .catch(() => {
        setMessage('Smazání se nezdařilo.');
      });
  };

  const updateField = (key: keyof EditorFormState, value: string) => {
    setForm((prev) => {
      const next = { ...prev, [key]: value } as EditorFormState;
      if (key === 'title') {
        const nextSlug = slugify(value);
        if (!prev.slug || prev.slug === slugify(prev.title)) {
          next.slug = nextSlug;
        }
      }
      return next;
    });
  };

  return (
    <SiteShell>
      <main className="homepage-main">
        <p className="homepage-eyebrow">SPTO · Redakce</p>
        <h1>Redakce článků</h1>
        <p className="homepage-lead">Správa článků pro zelenaliga.cz.</p>

        {session === 'checking' ? (
          <div className="homepage-card">Načítám…</div>
        ) : session === 'unauth' ? (
          <div className="homepage-card editor-login">
            <h2>Přihlášení</h2>
            <form onSubmit={handleLogin}>
              <label htmlFor="editor-password">Heslo</label>
              <input
                id="editor-password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Zadej heslo"
                required
              />
              <button type="submit" className="homepage-button">
                Přihlásit
              </button>
            </form>
            {message ? <p className="homepage-alert">{message}</p> : null}
          </div>
        ) : (
          <div className="editor-grid">
            <div className="homepage-card">
              <div className="editor-list-header">
                <h2>Články</h2>
                <div className="editor-list-actions">
                  <button type="button" className="homepage-button homepage-button--ghost" onClick={handleNew}>
                    Nový
                  </button>
                  <button type="button" className="homepage-button homepage-button--ghost" onClick={handleLogout}>
                    Odhlásit
                  </button>
                </div>
              </div>
              <ul className="editor-list">
                {articles.map((article) => (
                  <li key={article.id}>
                    <button
                      type="button"
                      className={`editor-list-item${article.id === activeId ? ' is-active' : ''}`}
                      onClick={() => selectArticle(article)}
                    >
                      <span>{article.title}</span>
                      <small>{article.status === 'published' ? 'Publikováno' : 'Rozpracováno'}</small>
                    </button>
                  </li>
                ))}
              </ul>
            </div>

            <div className="homepage-card editor-form">
              <h2>{activeId ? 'Upravit článek' : 'Nový článek'}</h2>
              <div className="editor-form-grid">
                <label>
                  Titulek
                  <input
                    value={form.title}
                    onChange={(event) => updateField('title', event.target.value)}
                    placeholder="Název článku"
                  />
                </label>
                <label>
                  Slug
                  <input
                    value={form.slug}
                    onChange={(event) => updateField('slug', event.target.value)}
                    placeholder="napr. setonuv-zavod-2025"
                  />
                </label>
                <label>
                  Autor
                  <input
                    value={form.author}
                    onChange={(event) => updateField('author', event.target.value)}
                    placeholder="Jméno autora"
                  />
                </label>
                <label>
                  Stav
                  <select
                    value={form.status}
                    onChange={(event) =>
                      setForm((prev) => ({ ...prev, status: event.target.value as EditorFormState['status'] }))
                    }
                  >
                    <option value="draft">Rozpracováno</option>
                    <option value="published">Publikováno</option>
                  </select>
                </label>
              </div>
              <label>
                Perex
                <textarea
                  value={form.excerpt}
                  onChange={(event) => updateField('excerpt', event.target.value)}
                  rows={3}
                />
              </label>
              <label>
                Text článku
                <textarea
                  value={form.body}
                  onChange={(event) => updateField('body', event.target.value)}
                  rows={12}
                />
              </label>
              <div className="editor-form-grid">
                <label>
                  URL obrázku
                  <input
                    value={form.cover_image_url}
                    onChange={(event) => updateField('cover_image_url', event.target.value)}
                    placeholder="https://..."
                  />
                </label>
                <label>
                  Popisek obrázku
                  <input
                    value={form.cover_image_alt}
                    onChange={(event) => updateField('cover_image_alt', event.target.value)}
                    placeholder="Popisek pro obrázek"
                  />
                </label>
              </div>
              <div className="editor-form-actions">
                {message ? <p className="homepage-alert">{message}</p> : null}
                <div className="editor-buttons">
                  {activeId ? (
                    <button type="button" className="homepage-button homepage-button--ghost" onClick={handleDelete}>
                      Smazat
                    </button>
                  ) : null}
                  <button type="button" className="homepage-button" onClick={handleSave}>
                    Uložit
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </SiteShell>
  );
}

function GalleryAlbumCard({ album }: { album: DriveAlbum }) {
  const [preview, setPreview] = useState<GalleryPreview | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let active = true;
    if (!album.folderId) {
      return undefined;
    }
    setLoading(true);
    fetchAlbumPreview(album.folderId)
      .then((data) => {
        if (active) {
          setPreview(data);
        }
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [album.folderId]);

  const coverPhoto = preview?.files?.find((file) => file.thumbnailLink || file.fullImageUrl || file.webContentLink) ?? null;
  const coverUrl = getPhotoThumbUrl(coverPhoto ?? undefined, 1200) || null;
  const previewPhotos = preview?.files ?? [];

  return (
    <a className="gallery-album-card" href={`/fotogalerie/${album.slug}`}>
      <div className="gallery-album-cover">
        {coverUrl ? (
          <img src={coverUrl} alt={album.title} loading="lazy" decoding="async" />
        ) : (
          <div className="gallery-album-cover-placeholder" />
        )}
        <span className="gallery-album-date">{album.year}</span>
      </div>
      <div className="gallery-album-body">
        <div>
          <h3>{album.title}</h3>
          <p>{album.year}</p>
        </div>
        <p className="gallery-album-count">
          {loading
            ? 'Načítám…'
            : preview?.totalCount !== null && preview?.totalCount !== undefined
              ? `${preview.totalCount} fotek`
              : 'Fotky se načítají'}
        </p>
      </div>
      <div className="gallery-album-thumbs">
        {previewPhotos.length > 0 ? (
          previewPhotos.slice(0, 4).map((photo) => {
            const thumbUrl = getPhotoThumbUrl(photo, 360);
            return thumbUrl ? (
              <img
                key={photo.fileId}
                src={thumbUrl}
                alt={photo.name}
                loading="lazy"
                decoding="async"
                fetchPriority="low"
              />
            ) : null;
          })
        ) : (
          <div className="gallery-album-thumbs-placeholder">Náhledy se připravují</div>
        )}
      </div>
    </a>
  );
}

function GalleryOverviewPage({ albums, loading }: { albums: DriveAlbum[]; loading: boolean }) {
  const grouped = useMemo(() => {
    const groups = new Map<string, DriveAlbum[]>();
    albums.forEach((album) => {
      const key = album.year || 'Ostatní';
      if (!groups.has(key)) {
        groups.set(key, []);
      }
      groups.get(key)!.push(album);
    });
    groups.forEach((items) => items.sort((a, b) => a.title.localeCompare(b.title, 'cs')));
    return Array.from(groups.entries()).sort((a, b) => b[0].localeCompare(a[0]));
  }, [albums]);

  return (
    <SiteShell>
      <main className="homepage-main homepage-single gallery-page" aria-labelledby="gallery-heading">
        <p className="homepage-eyebrow">SPTO · Fotogalerie</p>
        <h1 id="gallery-heading">Fotogalerie</h1>
        <p className="homepage-lead">Veřejná galerie akcí SPTO s fotkami uloženými na Google Drive.</p>
        {loading ? (
          <div className="homepage-card">Načítám alba…</div>
        ) : null}
        {!loading && albums.length === 0 ? (
          <div className="homepage-card">Zatím nejsou publikovaná žádná alba.</div>
        ) : null}
        {grouped.map(([year, items]) => (
          <section key={year} className="gallery-year-section">
            <div className="gallery-year-header">
              <h2>{year}</h2>
            </div>
            <div className="gallery-album-grid">
              {items.map((album) => (
                <GalleryAlbumCard key={album.slug} album={album} />
              ))}
            </div>
          </section>
        ))}
      </main>
    </SiteShell>
  );
}

function GalleryAlbumPage({
  slug,
  albums,
  loading: albumsLoading,
}: {
  slug: string;
  albums: DriveAlbum[];
  loading: boolean;
}) {
  const [album, setAlbum] = useState<DriveAlbum | null>(() => albums.find((item) => item.slug === slug) ?? null);
  const [photos, setPhotos] = useState<GalleryPhoto[]>([]);
  const [nextPageToken, setNextPageToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  useEffect(() => {
    const match = albums.find((item) => item.slug === slug) ?? null;
    if (match) {
      setAlbum(match);
    }
  }, [albums, slug]);

  useEffect(() => {
    let active = true;
    if (!album?.folderId) {
      return undefined;
    }
    setIsLoading(true);
    const params = new URLSearchParams({
      folderId: album.folderId,
      pageSize: String(GALLERY_PAGE_SIZE),
      includeSubfolders: '1',
    });
    fetch(`/api/gallery/album?${params.toString()}`)
      .then(async (response) => {
        if (!response.ok) {
          throw new Error('Failed to load album photos.');
        }
        return response.json();
      })
      .then((data) => {
        if (!active) {
          return;
        }
        setPhotos(data.files ?? []);
        setNextPageToken(data.nextPageToken ?? null);
      })
      .catch(() => {
        if (active) {
          setPhotos([]);
        }
      })
      .finally(() => {
        if (active) {
          setIsLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [album?.folderId]);

  const handleLoadMore = async () => {
    if (!album?.folderId || !nextPageToken || isLoading) {
      return;
    }
    setIsLoading(true);
    const params = new URLSearchParams({
      folderId: album.folderId,
      pageSize: String(GALLERY_PAGE_SIZE),
      pageToken: nextPageToken,
      includeSubfolders: '1',
    });
    try {
      const response = await fetch(`/api/gallery/album?${params.toString()}`);
      if (!response.ok) {
        throw new Error('Failed to load more photos.');
      }
      const data = await response.json();
      setPhotos((prev) => [...prev, ...(data.files ?? [])]);
      setNextPageToken(data.nextPageToken ?? null);
    } finally {
      setIsLoading(false);
    }
  };

  const activePhoto = lightboxIndex !== null ? photos[lightboxIndex] : null;
  const isFirstPhoto = lightboxIndex === 0;
  const isLastPhoto = lightboxIndex !== null && lightboxIndex === photos.length - 1;
  const getLightboxUrl = (photo?: GalleryPhoto | null) => {
    if (!photo) {
      return '';
    }
    if (photo.thumbnailLink) {
      return toDriveSizedUrl(photo.thumbnailLink, 1800);
    }
    return photo.fullImageUrl ?? photo.webContentLink ?? '';
  };
  const activePhotoUrl = getLightboxUrl(activePhoto);

  useEffect(() => {
    if (lightboxIndex === null) {
      return;
    }
    const preload = (index: number) => {
      const photo = photos[index];
      if (!photo) {
        return;
      }
      const url = getLightboxUrl(photo);
      if (!url) {
        return;
      }
      const image = new Image();
      image.src = url;
    };
    preload(lightboxIndex + 1);
    preload(lightboxIndex - 1);
  }, [lightboxIndex, photos]);

  if (!album) {
    if (albumsLoading) {
      return (
        <SiteShell>
          <main className="homepage-main homepage-single">
            <div className="homepage-card">Načítám album…</div>
          </main>
        </SiteShell>
      );
    }
    return <NotFoundPage />;
  }

  return (
    <SiteShell>
      <main className="homepage-main homepage-single gallery-page" aria-labelledby="album-heading">
        <p className="homepage-eyebrow">SPTO · Fotogalerie</p>
        <h1 id="album-heading">{album.title}</h1>
        <p className="homepage-lead">
          {album.year}
        </p>
        <div className="gallery-photo-grid">
          {photos.map((photo, index) => (
            <button
              key={photo.fileId}
              type="button"
              className="gallery-photo-thumb"
              onClick={() => setLightboxIndex(index)}
            >
              {getPhotoThumbUrl(photo, 640) ? (
                <img
                  src={getPhotoThumbUrl(photo, 640)}
                  alt={photo.name}
                  loading={index < 6 ? 'eager' : 'lazy'}
                  decoding="async"
                  sizes="(max-width: 600px) 45vw, (max-width: 900px) 30vw, 220px"
                  fetchPriority={index < 4 ? 'high' : 'auto'}
                />
              ) : (
                <span>{photo.name}</span>
              )}
            </button>
          ))}
        </div>
        {!isLoading && photos.length === 0 ? <div className="gallery-loading">Zatím zde nejsou žádné fotky.</div> : null}
        {isLoading ? <div className="gallery-loading">Načítám fotky…</div> : null}
        {nextPageToken ? (
          <button type="button" className="homepage-cta secondary gallery-load-more" onClick={handleLoadMore} disabled={isLoading}>
            Načíst další fotky
          </button>
        ) : null}
        <a className="homepage-back-link" href="/fotogalerie">
          Zpět na fotogalerii
        </a>
      </main>
      {activePhoto ? (
        <div className="gallery-lightbox" role="dialog" aria-modal="true">
          <button type="button" className="gallery-lightbox-close" onClick={() => setLightboxIndex(null)}>
            ✕
          </button>
          <button
            type="button"
            className="gallery-lightbox-nav prev"
            onClick={() => setLightboxIndex((prev) => (prev !== null && prev > 0 ? prev - 1 : prev))}
            aria-label="Předchozí fotka"
            disabled={isFirstPhoto}
          >
            ‹
          </button>
          <figure>
            <img
              src={activePhotoUrl}
              alt={activePhoto.name}
              loading="eager"
              decoding="async"
            />
            <figcaption>{activePhoto.name}</figcaption>
          </figure>
          <button
            type="button"
            className="gallery-lightbox-nav next"
            onClick={() =>
              setLightboxIndex((prev) => (prev !== null && prev < photos.length - 1 ? prev + 1 : prev))
            }
            aria-label="Další fotka"
            disabled={isLastPhoto}
          >
            ›
          </button>
        </div>
      ) : null}
    </SiteShell>
  );
}

function ArticlePageLoader({ slug, articles }: { slug: string; articles: Article[] }) {
  const [article, setArticle] = useState<Article | null>(
    () => articles.find((item) => item.href.split('/').pop() === slug) ?? null,
  );

  useEffect(() => {
    const match = articles.find((item) => item.href.split('/').pop() === slug) ?? null;
    if (match) {
      setArticle(match);
    }
  }, [articles, slug]);

  useEffect(() => {
    let active = true;
    if (article) {
      return undefined;
    }
    fetchContentArticle(slug).then((data) => {
      if (!active || !data) {
        return;
      }
      setArticle(mapContentArticle(data));
    });
    return () => {
      active = false;
    };
  }, [article, slug]);

  if (!article) {
    return (
      <InfoPage
        eyebrow="SPTO · Články"
        title="Načítám článek"
        lead="Obsah článku se právě připravuje."
        backHref="/clanky"
      />
    );
  }

  return <ArticlePage article={article} />;
}

function formatTroopName(troop: Troop) {
  if (!troop.number || !/^\d+$/.test(troop.number)) {
    return troop.name;
  }
  return `${troop.number}. PTO ${troop.name}`;
}

function formatTroopDescription(troop: Troop) {
  const detailParts = [];
  if (troop.year) {
    detailParts.push(`založeno ${troop.year}`);
  }
  if (troop.leader) {
    detailParts.push(`vedoucí ${troop.leader}`);
  }
  return detailParts.join(' · ');
}

function resolveTroopLogo(troop: Troop) {
  const keyFromNumber = troop.number && /^\d+$/.test(troop.number) ? troop.number : null;
  const key = (troop.logoKey ?? keyFromNumber ?? '').toLowerCase();
  if (!key) {
    return null;
  }
  return TROOP_LOGO_SOURCES[key] ?? null;
}

function formatLeagueScore(value: number | null) {
  if (value === null || Number.isNaN(value)) {
    return '—';
  }
  return value.toLocaleString('cs-CZ', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

type LeagueRow = {
  key: string;
  name: string;
  scores: Array<number | null>;
  total: number | null;
  order: number;
};

type LeagueRowWithRank = LeagueRow & { rank: number };

function buildLeagueRows(): LeagueRow[] {
  return LEAGUE_TROOPS.map((troop, index) => {
    const scores = LEAGUE_EVENTS.map((event) => CURRENT_LEAGUE_SCORES[troop.id]?.[event.key] ?? null);
    const hasScores = scores.some((value) => value !== null);
    const total = hasScores ? scores.reduce<number>((sum, value) => sum + (value ?? 0), 0) : null;
    return {
      key: troop.id,
      name: troop.name,
      scores,
      total,
      order: index,
    };
  }).sort((a, b) => {
    if (a.total === null && b.total === null) {
      return a.order - b.order;
    }
    if (a.total === null) {
      return 1;
    }
    if (b.total === null) {
      return -1;
    }
    if (b.total !== a.total) {
      return b.total - a.total;
    }
    return a.order - b.order;
  });
}

function addCompetitionRanks(rows: LeagueRow[]): LeagueRowWithRank[] {
  let lastTotal: number | null = null;
  let lastRank = 0;
  return rows.map((row, index) => {
    if (lastTotal !== null && row.total !== null && row.total === lastTotal) {
      return { ...row, rank: lastRank };
    }
    const rank = index + 1;
    lastRank = rank;
    lastTotal = row.total;
    return { ...row, rank };
  });
}

function resolveActiveNav(pathname: string) {
  const normalized = pathname.replace(/\/$/, '') || '/';
  const segments = normalized.split('/').filter(Boolean);
  if (segments.length === 0) {
    return undefined;
  }
  const slug = segments[0];
  if (slug === 'souteze' || slug === 'aplikace' || COMPETITIONS.some((event) => event.slug === slug)) {
    return 'souteze';
  }
  if (slug === 'aktualni-poradi' || slug === 'zelena-liga') {
    return 'aktualni-poradi';
  }
  if (slug === 'oddily') {
    return 'oddily';
  }
  if (slug === 'fotogalerie') {
    return 'fotogalerie';
  }
  if (slug === 'clanky') {
    return 'clanky';
  }
  if (slug === 'o-spto' || slug === 'historie') {
    return 'o-spto';
  }
  if (slug === 'kontakty') {
    return 'kontakty';
  }
  return undefined;
}

function SiteHeader({
  activeSection,
  title,
  subtitle,
}: {
  activeSection?: string;
  title?: string;
  subtitle?: string;
}) {
  const [navOpen, setNavOpen] = useState(false);
  const navPanelId = 'homepage-nav-panel';
  const handleNavToggle = () => {
    setNavOpen((prev) => !prev);
  };
  const handleNavLinkClick = () => {
    setNavOpen(false);
  };

  return (
    <>
      <header className="homepage-header">
        <div className="homepage-header-inner">
          <a className="homepage-hero-logo" href="https://zelenaliga.cz">
            <img src={logo} alt="Logo Zelená liga" />
            <span className="homepage-logo-caption">SPTO Brno</span>
          </a>
          <div className="homepage-header-copy">
            <p className="homepage-eyebrow">SPTO · Zelená liga</p>
            <h1>{title ?? 'SPTO a Zelená liga'}</h1>
            <p className="homepage-subtitle">{subtitle ?? HEADER_SUBTITLE}</p>
          </div>
        </div>
      </header>

      <nav className="homepage-nav" aria-label="Hlavní navigace">
        <div className="homepage-nav-bar">
          <span className="homepage-nav-title">Navigace</span>
          <button
            className={`homepage-nav-toggle${navOpen ? ' is-open' : ''}`}
            type="button"
            aria-expanded={navOpen}
            aria-controls={navPanelId}
            onClick={handleNavToggle}
          >
            <span className="homepage-nav-toggle-text">Menu</span>
            <span className="homepage-nav-toggle-icon" aria-hidden="true">
              <span />
              <span />
              <span />
            </span>
          </button>
        </div>
        <div className={`homepage-nav-panel${navOpen ? ' is-open' : ''}`} id={navPanelId}>
          <div className="homepage-nav-inner">
            {NAV_ITEMS.map((item) => {
              const isActive = activeSection === item.id;
              return (
                <a
                  key={item.id}
                  href={item.href}
                  onClick={handleNavLinkClick}
                  aria-current={isActive ? 'page' : undefined}
                  className={`homepage-nav-link${isActive ? ' is-active' : ''}`}
                >
                  <span className="homepage-nav-dot" aria-hidden="true" />
                  {item.label}
                </a>
              );
            })}
          </div>
        </div>
      </nav>
    </>
  );
}

function SiteShell({
  children,
  activeSection,
  headerTitle,
  headerSubtitle,
}: {
  children: React.ReactNode;
  activeSection?: string;
  headerTitle?: string;
  headerSubtitle?: string;
}) {
  const resolvedActiveSection =
    activeSection ?? (typeof window !== 'undefined' ? resolveActiveNav(window.location.pathname) : undefined);
  return (
    <div className="homepage-shell" style={{ scrollBehavior: 'smooth' }}>
      <SiteHeader activeSection={resolvedActiveSection} title={headerTitle} subtitle={headerSubtitle} />
      {children}
      <AppFooter className="homepage-footer" />
    </div>
  );
}

function HomepageCarousel({ images }: { images: CarouselImage[] }) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [isPaused, setIsPaused] = useState(false);

  useEffect(() => {
    if (images.length <= 1 || isPaused) {
      return;
    }
    const timer = window.setInterval(() => {
      setActiveIndex((prev) => (prev + 1) % images.length);
    }, 7000);
    return () => window.clearInterval(timer);
  }, [images.length, isPaused]);

  useEffect(() => {
    if (activeIndex >= images.length) {
      setActiveIndex(0);
    }
  }, [activeIndex, images.length]);

  const handlePrev = () => {
    setActiveIndex((prev) => (prev - 1 + images.length) % images.length);
  };
  const handleNext = () => {
    setActiveIndex((prev) => (prev + 1) % images.length);
  };

  if (images.length === 0) {
    return null;
  }

  return (
    <section className="homepage-carousel" aria-label="Fotky z akcí SPTO">
      <div
        className="homepage-carousel-frame"
        onMouseEnter={() => setIsPaused(true)}
        onMouseLeave={() => setIsPaused(false)}
      >
        <div className="homepage-carousel-track" style={{ transform: `translateX(-${activeIndex * 100}%)` }}>
          {images.map((image) => (
            <figure key={image.id} className="homepage-carousel-slide">
              <img src={image.src} alt={image.alt} loading="lazy" />
            </figure>
          ))}
        </div>
        {images.length > 1 ? (
          <>
            <button type="button" className="homepage-carousel-arrow prev" onClick={handlePrev} aria-label="Předchozí fotka">
              ‹
            </button>
            <button type="button" className="homepage-carousel-arrow next" onClick={handleNext} aria-label="Další fotka">
              ›
            </button>
          </>
        ) : null}
      </div>
      {images.length > 1 ? (
        <div className="homepage-carousel-dots" role="tablist" aria-label="Vybrat fotku">
          {images.map((image, index) => (
            <button
              key={image.id}
              type="button"
              className={`homepage-carousel-dot${index === activeIndex ? ' is-active' : ''}`}
              onClick={() => setActiveIndex(index)}
              aria-label={`Fotka ${index + 1} z ${images.length}`}
              aria-pressed={index === activeIndex}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
}

function Homepage({
  homepageContent,
  articles,
}: {
  homepageContent: SanityHomepage | null;
  articles: Article[];
}) {
  const headerTitle = homepageContent?.heroTitle ?? undefined;
  const headerSubtitle = homepageContent?.heroSubtitle ?? undefined;

  return (
    <SiteShell
      headerTitle={headerTitle ?? undefined}
      headerSubtitle={headerSubtitle ?? undefined}
    >
      <main className="homepage-main" aria-labelledby="homepage-intro-heading" style={{ maxWidth: '1120px', gap: '64px' }}>
        <HomepageCarousel images={HOMEPAGE_CAROUSEL} />
        <section className="homepage-section" aria-labelledby="homepage-intro-heading">
          <div className="homepage-section-header" style={{ textAlign: 'left', alignItems: 'flex-start', maxWidth: '720px' }}>
            <h2 id="homepage-intro-heading">O SPTO a Zelené lize</h2>
            <span className="homepage-section-accent" aria-hidden="true" style={{ alignSelf: 'flex-start' }} />
          </div>
          <div className="homepage-card" style={{ maxWidth: '920px', boxShadow: 'none' }}>
            {homepageContent?.intro?.length ? (
              <PortableText value={homepageContent.intro} components={portableTextComponents} />
            ) : (
              <>
                <p>
                  SPTO sdružuje pionýrské tábornické oddíly (PTO), které vedou děti a mladé k pobytu v přírodě,
                  spolupráci a dobrodružství. Pravidelné schůzky, víkendové výpravy i letní tábory jsou otevřené všem,
                  kdo chtějí zažít táborový život naplno.
                </p>
                <p style={{ marginTop: '12px' }}>
                  Zelená liga je celoroční soutěžní rámec SPTO. Skládá se z několika závodů během roku
                  (například Setonův závod) a soutěžící jsou rozděleni do věkových kategorií.
                </p>
              </>
            )}
          </div>
        </section>

        <section className="homepage-section" id="clanky" aria-labelledby="clanky-heading">
          <div className="homepage-section-header" style={{ textAlign: 'left', alignItems: 'flex-start', maxWidth: '720px' }}>
            <h2 id="clanky-heading">Články ze soutěží</h2>
            <span className="homepage-section-accent" aria-hidden="true" style={{ alignSelf: 'flex-start' }} />
          </div>
          <div className="homepage-article-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
            {articles.map((article) => (
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

        <section className="homepage-section" id="zelenaliga" aria-labelledby="zelenaliga-heading">
          <div className="homepage-section-header" style={{ textAlign: 'left', alignItems: 'flex-start', maxWidth: '720px' }}>
            <h2 id="zelenaliga-heading">Zelená liga</h2>
            <span className="homepage-section-accent" aria-hidden="true" style={{ alignSelf: 'flex-start' }} />
          </div>
          <div className="homepage-card homepage-league-card is-compact">
            <div className="homepage-league-top" style={{ padding: '24px' }}>
              <h3>Top {LEAGUE_TOP_COUNT} oddílů</h3>
              <ol>
                {addCompetitionRanks(buildLeagueRows())
                  .slice(0, LEAGUE_TOP_COUNT)
                  .map((row, index) => (
                    <li
                      key={row.key}
                      style={{ display: 'grid', gridTemplateColumns: '32px 1fr', gap: '12px', alignItems: 'center' }}
                    >
                      <span className="homepage-league-rank" style={{ textAlign: 'right' }}>
                        {row.rank}.
                      </span>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                        <strong>{row.name}</strong>
                        <span>{row.total === null ? '— bodů' : `${formatLeagueScore(row.total)} bodů`}</span>
                      </div>
                    </li>
                  ))}
              </ol>
            </div>
            <div className="homepage-league-actions">
              <a className="homepage-cta secondary" href="/aktualni-poradi">
                Zobrazit celé pořadí
              </a>
            </div>
          </div>
        </section>

        <section className="homepage-section" id="o-spto" aria-labelledby="o-spto-heading">
          <div className="homepage-section-header" style={{ textAlign: 'left', alignItems: 'flex-start', maxWidth: '720px' }}>
            <h2 id="o-spto-heading">O SPTO</h2>
            <span className="homepage-section-accent" aria-hidden="true" style={{ alignSelf: 'flex-start' }} />
          </div>
          <div className="homepage-card" style={{ maxWidth: '880px' }}>
            <ul className="homepage-about-list">
              {SPTO_HISTORY_HIGHLIGHTS.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
            <a className="homepage-inline-link" href="/o-spto">
              Více o SPTO
            </a>
          </div>
        </section>
      </main>
    </SiteShell>
  );
}

function CompetitionsPage() {
  return (
    <SiteShell>
      <main className="homepage-main homepage-single" aria-labelledby="competitions-heading">
        <p className="homepage-eyebrow">SPTO · Soutěže</p>
        <h1 id="competitions-heading">Soutěže SPTO</h1>
        <p className="homepage-lead">Přehled závodů Zelené ligy a souvisejících aplikací.</p>
        <div className="homepage-card">
          <div className="homepage-souteze-grid">
            <div className="homepage-souteze-block">
              <h2>Soutěže</h2>
              <ul className="homepage-list">
                {COMPETITIONS.map((competition) => (
                  <li key={competition.slug}>
                    <a className="homepage-inline-link" href={competition.href}>
                      {competition.name}
                    </a>
                    <p>{competition.description ?? 'Pravidla a dokumenty k soutěži.'}</p>
                  </li>
                ))}
              </ul>
            </div>
            <div className="homepage-souteze-block">
              <h2>Aplikace</h2>
              <ul className="homepage-list">
                {APPLICATION_LINKS.map((app) => (
                  <li key={app.href}>
                    <a className="homepage-inline-link" href={app.href}>
                      {app.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
        <a className="homepage-back-link" href="/">
          Zpět na hlavní stránku
        </a>
      </main>
    </SiteShell>
  );
}

function ApplicationsPage() {
  return (
    <SiteShell>
      <main className="homepage-main homepage-single" aria-labelledby="apps-heading">
        <p className="homepage-eyebrow">SPTO · Aplikace</p>
        <h1 id="apps-heading">Aplikace SPTO</h1>
        <p className="homepage-lead">Digitální nástroje pro soutěže, bodování a výsledky.</p>
        <div className="homepage-card">
          <ul className="homepage-list">
            {APPLICATION_LINKS.map((app) => (
              <li key={app.href}>
                <a className="homepage-inline-link" href={app.href}>
                  {app.label}
                </a>
              </li>
            ))}
          </ul>
        </div>
        <a className="homepage-back-link" href="/">
          Zpět na hlavní stránku
        </a>
      </main>
    </SiteShell>
  );
}

function LeagueStandingsPage() {
  const leagueGridTemplate = `minmax(220px, 1.3fr) repeat(${LEAGUE_EVENTS.length}, minmax(90px, 1fr)) minmax(90px, 0.8fr)`;
  const rows = addCompetitionRanks(buildLeagueRows());
  const hasAnyScores = rows.some((row) => row.total !== null);

  return (
    <SiteShell>
      <main className="homepage-main homepage-single homepage-league-page" aria-labelledby="league-heading">
        <p className="homepage-eyebrow">SPTO · Zelená liga</p>
        <h1 id="league-heading">Aktuální pořadí</h1>
        <p className="homepage-lead">Body oddílů v jednotlivých soutěžích a celkový součet.</p>
        <div className="homepage-card homepage-league-table-card">
          {!hasAnyScores ? (
            <p className="homepage-league-note">Body doplníme po napojení na tabulku s aktuálním pořadím.</p>
          ) : null}
          <div className="homepage-league-table" style={{ '--league-grid': leagueGridTemplate } as React.CSSProperties}>
            <div className="homepage-league-row homepage-league-header">
              <span>Oddíl</span>
              {LEAGUE_EVENTS.map((event) => (
                <span key={event.key} className="homepage-league-score">
                  {event.label}
                </span>
              ))}
              <span className="homepage-league-score">Celkem</span>
            </div>
            {rows.map((row, index) => (
              <div key={row.key} className="homepage-league-row">
                <span className="homepage-league-name" data-label="Oddíl">
                  <strong className="homepage-league-rank">{row.rank}.</strong> {row.name}
                </span>
                {row.scores.map((score, scoreIndex) => {
                  const event = LEAGUE_EVENTS[scoreIndex];
                  return (
                    <span key={`${row.key}-${scoreIndex}`} className="homepage-league-score" data-label={event.label}>
                      {formatLeagueScore(score)}
                    </span>
                  );
                })}
                <span className="homepage-league-score homepage-league-total" data-label="Celkem">
                  {formatLeagueScore(row.total)}
                </span>
              </div>
            ))}
          </div>
        </div>
        <div className="homepage-card homepage-league-history-card">
          <h2>Historické pořadí</h2>
          {HISTORICAL_LEAGUE_EMBED_URL ? (
            <div className="homepage-league-embed">
              <iframe
                src={HISTORICAL_LEAGUE_EMBED_URL}
                title="Historické pořadí Zelené ligy"
                loading="lazy"
                allowFullScreen
              />
            </div>
          ) : (
            <p>Sem vložíme Google tabulku s historickým pořadím. Pošli prosím embed link.</p>
          )}
        </div>
        <a className="homepage-back-link" href="/">
          Zpět na hlavní stránku
        </a>
      </main>
    </SiteShell>
  );
}

interface CompetitionRulesPageProps {
  slug: string;
}

function CompetitionRulesPage({ slug }: CompetitionRulesPageProps) {
  const competition = COMPETITIONS.find((item) => item.slug === slug);

  if (!competition) {
    return <NotFoundPage />;
  }

  const rules = getCompetitionRules(competition);

  return (
    <SiteShell>
      <main className="homepage-main homepage-single" aria-labelledby="rules-heading">
        <p className="homepage-eyebrow">SPTO · Soutěže</p>
        <h1 id="rules-heading">{competition.name}</h1>
        <p className="homepage-lead">{competition.description ?? 'Pravidla a dokumenty k soutěži.'}</p>
        {rules.length > 0 ? (
          <div className="homepage-pdf-stack">
            {rules.map((rule) => {
              const label = formatRuleLabel(rule.filename);
              return (
                <div key={rule.filename} className="homepage-card">
                  <h2>{label}</h2>
                  <PdfEmbedCard title={label} url={rule.url} />
                </div>
              );
            })}
          </div>
        ) : (
          <div className="homepage-card">
            <p>Pravidla pro tuto soutěž připravujeme.</p>
          </div>
        )}
        <a className="homepage-back-link" href="/souteze">
          Zpět na soutěže
        </a>
      </main>
    </SiteShell>
  );
}

function AboutSptoPage() {
  return (
    <SiteShell>
      <main className="homepage-main homepage-single" aria-labelledby="about-spto-heading">
        <p className="homepage-eyebrow">SPTO · O SPTO</p>
        <h1 id="about-spto-heading">O SPTO</h1>
        <p className="homepage-lead">Historie, založení a zásady fungování Sdružení pionýrských tábornických oddílů.</p>

        <div className="homepage-card">
          <div className="homepage-about-grid">
            <div className="homepage-about-card">
              <h2>Z historie SPTO</h2>
              <ul className="homepage-about-list">
                {SPTO_HISTORY_HIGHLIGHTS.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
            <div className="homepage-about-card">
              <h2>Založení SPTO – novodobé</h2>
              <ul className="homepage-about-list">
                {SPTO_FOUNDING_HIGHLIGHTS.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
            <div className="homepage-about-card">
              <h2>Zakládající oddíly roku 1990</h2>
              <ul className="homepage-about-list homepage-about-list--columns">
                {SPTO_FOUNDING_TROOPS.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
            <div className="homepage-about-card">
              <h2>Čestné členství v SPTO</h2>
              <ul className="homepage-about-list">
                {SPTO_HONORARY_MEMBERS.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>

        <div className="homepage-card">
          <h2>Náčelníci SPTO Brno</h2>
          <ul className="homepage-about-list homepage-about-list--chiefs">
            {SPTO_CHIEFS.map((chief) => (
              <li key={`${chief.name}-${chief.term}`}>
                <strong>{chief.name}</strong>
                <span>{chief.troop}</span>
                <span>{chief.term}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="homepage-card">
          <h2>Zásady činnosti SPTO (únor 2016)</h2>
          {SPTO_POLICY_PDF ? (
            <PdfEmbedCard title="Zásady činnosti SPTO (únor 2016)" url={SPTO_POLICY_PDF.url} />
          ) : (
            <p>Soubor zásad se nepodařilo načíst. Zkus prosím obnovit stránku.</p>
          )}
        </div>

        <a className="homepage-back-link" href="/">
          Zpět na hlavní stránku
        </a>
      </main>
    </SiteShell>
  );
}

export default function ZelenaligaSite() {
  const [homepageContent, setHomepageContent] = useState<SanityHomepage | null>(null);
  const [articles, setArticles] = useState<Article[]>(ARTICLES);
  const [driveAlbums, setDriveAlbums] = useState<DriveAlbum[]>([]);
  const [driveAlbumsLoading, setDriveAlbumsLoading] = useState(false);
  const path = window.location.pathname.replace(/\/$/, '') || '/';
  const segments = path.split('/').filter(Boolean);

  useEffect(() => {
    if (!hasSanityConfig()) {
      return;
    }
    let active = true;
    fetchHomepage()
      .then((homepageData) => {
        if (!active) {
          return;
        }
        setHomepageContent(homepageData);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    fetchContentArticles()
      .then((articlesData) => {
        if (!active) {
          return;
        }
        if (articlesData.length > 0) {
          setArticles(articlesData.map(mapContentArticle));
        }
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    setDriveAlbumsLoading(true);
    fetch('/api/gallery/albums')
      .then(async (response) => {
        if (!response.ok) {
          throw new Error('Failed to load albums.');
        }
        return response.json();
      })
      .then((data) => {
        if (active) {
          setDriveAlbums(data.albums ?? []);
        }
      })
      .catch(() => {
        if (active) {
          setDriveAlbums([]);
        }
      })
      .finally(() => {
        if (active) {
          setDriveAlbumsLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, []);

  if (path === '/') {
    return (
      <Homepage
        homepageContent={homepageContent}
        articles={articles}
      />
    );
  }

  if (segments.length > 0) {
    const slug = segments[0];
    if (slug === 'redakce') {
      return <RedakcePage />;
    }
    if (slug === 'souteze') {
      if (segments.length > 1) {
        return <CompetitionRulesPage slug={segments[1]} />;
      }
      return <CompetitionsPage />;
    }

    if (slug === 'aktualni-poradi' || slug === 'zelena-liga') {
      return <LeagueStandingsPage />;
    }

    if (slug === 'aplikace') {
      return <ApplicationsPage />;
    }

    if (slug === 'oddily') {
      if (segments.length > 1) {
        const troopSlug = segments[1];
        const troop = TROOPS.find((item) => item.href.split('/').pop() === troopSlug);
        if (!troop) {
          return <NotFoundPage />;
        }
        return <TroopDetailPage troop={troop} />;
      }
      return <TroopsPage />;
    }

    if (slug === 'clanky') {
      if (segments.length > 1) {
        const articleSlug = segments[1];
        return <ArticlePageLoader slug={articleSlug} articles={articles} />;
      }
      return (
        <InfoPage
          eyebrow="SPTO · Články"
          title="Články ze soutěží"
          lead="Reportáže a novinky z posledních akcí."
          links={articles.map((item) => ({
            label: item.title,
            description: `${item.dateLabel} · ${item.excerpt}`,
            href: item.href,
          }))}
        />
      );
    }

    if (slug === 'fotogalerie') {
      if (segments.length > 1) {
        const albumSlug = segments[segments.length - 1];
        return <GalleryAlbumPage slug={albumSlug} albums={driveAlbums} loading={driveAlbumsLoading} />;
      }
      return <GalleryOverviewPage albums={driveAlbums} loading={driveAlbumsLoading} />;
    }

    if (slug === 'o-spto' || slug === 'historie') {
      return <AboutSptoPage />;
    }

    if (slug === 'kontakty') {
      return <ContactsPage />;
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
