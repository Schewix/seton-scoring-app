import './Homepage.css';
import { useEffect, useMemo, useState } from 'react';
import { PortableText } from '@portabletext/react';
import AppFooter from '../components/AppFooter';
import logo from '../assets/znak_SPTO_transparent.png';
import {
  fetchArticleBySlug,
  fetchArticles,
  fetchHomepage,
  hasSanityConfig,
  type SanityArticle,
  type SanityHomepage,
} from '../data/sanity';

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
  { id: 'souteze', label: 'Soutěže', href: '/souteze' },
  { id: 'aktualni-poradi', label: 'Aktuální pořadí', href: '/aktualni-poradi' },
  { id: 'oddily', label: 'Oddíly SPTO', href: '/oddily' },
  { id: 'fotogalerie', label: 'Fotogalerie', href: '/fotogalerie' },
  { id: 'clanky', label: 'Články a novinky', href: '/clanky' },
  { id: 'historie', label: 'Historie SPTO', href: '/historie' },
];

const LEAGUE_TOP = [
  { name: 'PTO Severka', city: 'Brno' },
  { name: 'PTO Ševa', city: 'Brno' },
  { name: 'PTO Orion', city: 'Blansko' },
  { name: 'PTO Tis', city: 'Třebíč' },
  { name: 'PTO Rosa', city: 'Hodonín' },
];

const LEAGUE_EVENTS = ['Setonův závod', 'Memoriál Bedřicha Stoličky', 'Sraz PTO', 'Dračí smyčka'] as const;

type LeagueEvent = (typeof LEAGUE_EVENTS)[number];

const CURRENT_LEAGUE_SCORES: Record<string, Partial<Record<LeagueEvent, number>>> = {};

const HISTORICAL_LEAGUE_EMBED_URL = '';

const CAROUSEL_IMAGE_SOURCES = Object.entries(
  import.meta.glob('../assets/homepage-carousel/*.{jpg,jpeg,png,webp}', {
    eager: true,
    import: 'default',
  }),
)
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([, src]) => src as string);

const HOMEPAGE_CAROUSEL = (CAROUSEL_IMAGE_SOURCES.length ? CAROUSEL_IMAGE_SOURCES : [logo, logo, logo]).map(
  (src, index) => ({
    id: `carousel-${index + 1}`,
    src,
    alt: 'Fotka z akcí SPTO',
  }),
);

type Article = {
  title: string;
  dateLabel: string;
  dateISO: string;
  excerpt: string;
  href: string;
  body: string[] | any[];
  author?: string;
  coverImage?: { url: string; alt?: string | null } | null;
};

type CarouselImage = {
  id: string;
  src: string;
  alt: string;
};

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
};

const TROOPS: Troop[] = [
  {
    number: '2',
    name: 'Poutníci',
    year: '1987',
    leader: 'Anna Dalecká',
    href: '/oddily/2-poutnici',
  },
  {
    number: '6',
    name: 'Nibowaka',
    year: '1982',
    leader: 'Tomáš Hála',
    href: '/oddily/6-nibowaka',
  },
  {
    number: '10',
    name: 'Severka',
    year: '1984',
    leader: 'Ondřej Uldrijan',
    href: '/oddily/10-severka',
  },
  {
    number: '11',
    name: 'Iktomi',
    year: '2013',
    leader: 'Linda Rahelová (Ovce)',
    href: '/oddily/11-iktomi',
  },
  {
    number: '15',
    name: 'Vatra',
    year: '1975',
    leader: 'Luděk Maar',
    href: '/oddily/15-vatra',
  },
  {
    number: '21',
    name: 'Hády',
    year: '1983',
    leader: 'Alena Nekvapilova',
    href: '/oddily/21-hady',
  },
  {
    number: '24',
    name: 'Života v přírodě',
    year: '1972',
    leader: 'Markéta Rokytová (Makýša)',
    href: '/oddily/24-zivota-v-prirode',
  },
  {
    number: '25',
    name: 'Ochrany přírody',
    leader: 'Vojtěch Hynšt',
    href: '/oddily/25-ochrany-prirody',
  },
  {
    number: '26',
    name: 'Kulturní historie',
    leader: 'Tobias Filouš (Lachtan)',
    href: '/oddily/26-kulturni-historie',
  },
  {
    number: '27',
    name: 'Lesní moudrosti',
    year: '1972',
    leader: 'František Urban',
    href: '/oddily/27-lesni-moudrosti',
  },
  {
    number: '32',
    name: 'Severka',
    year: '1985',
    leader: 'Eliška Masaříková (Elis)',
    href: '/oddily/32-severka',
  },
  {
    number: '34',
    name: 'Tulák',
    year: '1981',
    leader: 'František Reitter',
    href: '/oddily/34-tulak',
  },
  {
    number: '41',
    name: 'Dráčata',
    year: '1992',
    leader: 'Ing. Jaroslav Pipota',
    href: '/oddily/41-dracata',
  },
  {
    number: '48',
    name: 'Stezka',
    year: '1983',
    leader: 'Ivana Krumlova',
    href: '/oddily/48-stezka',
  },
  {
    number: '63',
    name: 'Phoenix',
    year: '1992',
    leader: 'Roman Valenta (Rogi)',
    href: '/oddily/63-phoenix',
  },
  {
    number: '64',
    name: 'Lorien',
    year: '1996',
    leader: 'René Hrabovský (Renda)',
    href: '/oddily/64-lorien',
  },
  {
    number: '66',
    name: 'Brabrouci Modřice',
    year: '1998',
    leader: 'Veronika Obdržálková (Špion)',
    href: '/oddily/66-brabrouci-modrice',
  },
  {
    number: '99',
    name: 'Kamzíci',
    leader: 'Radek Slavík (Bambus)',
    href: '/oddily/99-kamzici',
  },
  {
    number: '111',
    name: 'Vinohrady',
    year: '1990',
    leader: 'Radek Zeman',
    href: '/oddily/111-vinohrady',
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
    leader: 'Adam Vyklický (Áda)',
    href: '/oddily/176-vlcata',
  },
  {
    number: 'x',
    name: 'Žabky',
    year: '1993',
    leader: 'Pavlína Héčová (Spajdik)',
    href: '/oddily/x-zabky',
  },
];

const TROOP_HIGHLIGHTS = TROOPS.slice(0, 4);

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

function formatDateLabel(dateISO: string) {
  const date = new Date(dateISO);
  if (Number.isNaN(date.getTime())) {
    return dateISO;
  }
  return date.toLocaleDateString('cs-CZ', { day: '2-digit', month: '2-digit', year: 'numeric' });
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

function mapSanityArticle(article: SanityArticle): Article {
  const dateISO = article.publishedAt;
  return {
    title: article.title,
    dateISO,
    dateLabel: formatDateLabel(dateISO),
    excerpt: article.excerpt ?? '',
    href: `/clanky/${article.slug}`,
    body: article.body ?? [],
    author: article.author ?? undefined,
    coverImage: article.coverImage ?? undefined,
  };
}

async function fetchAlbumPreview(folderId: string): Promise<GalleryPreview> {
  const params = new URLSearchParams({
    folderId,
    pageSize: '4',
    includeCount: '1',
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

function ArticlePage({ article }: { article: Article }) {
  const isPortableText = Array.isArray(article.body) && typeof article.body[0] === 'object';
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
            <PortableText value={article.body} components={portableTextComponents} />
          ) : (
            (article.body as string[]).map((paragraph, index) => (
              <p key={`${article.href}-${index}`}>{paragraph}</p>
            ))
          )}
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
  }, [album.driveFolderId]);

  const coverUrl = preview?.files?.find((file) => file.thumbnailLink)?.thumbnailLink ?? null;
  const previewPhotos = preview?.files ?? [];

  return (
    <a className="gallery-album-card" href={`/fotogalerie/${album.slug}`}>
      <div className="gallery-album-cover">
        {coverUrl ? (
          <img src={coverUrl} alt={album.title} loading="lazy" />
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
          previewPhotos.slice(0, 4).map((photo) => (
            <img key={photo.fileId} src={photo.thumbnailLink ?? ''} alt={photo.name} loading="lazy" />
          ))
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
      <main className="homepage-main homepage-single" aria-labelledby="gallery-heading">
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

function GalleryAlbumPage({ slug, albums, loading }: { slug: string; albums: DriveAlbum[]; loading: boolean }) {
  const [album, setAlbum] = useState<DriveAlbum | null>(() => albums.find((item) => item.slug === slug) ?? null);
  const [photos, setPhotos] = useState<GalleryPhoto[]>([]);
  const [nextPageToken, setNextPageToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
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
    setLoading(true);
    const params = new URLSearchParams({ folderId: album.folderId, pageSize: '36' });
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
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [album?.driveFolderId]);

  const handleLoadMore = async () => {
    if (!album?.folderId || !nextPageToken || loading) {
      return;
    }
    setLoading(true);
    const params = new URLSearchParams({
      folderId: album.folderId,
      pageSize: '36',
      pageToken: nextPageToken,
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
      setLoading(false);
    }
  };

  const activePhoto = lightboxIndex !== null ? photos[lightboxIndex] : null;
  const isFirstPhoto = lightboxIndex === 0;
  const isLastPhoto = lightboxIndex !== null && lightboxIndex === photos.length - 1;

  if (!album) {
    if (loading) {
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
      <main className="homepage-main homepage-single" aria-labelledby="album-heading">
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
              {photo.thumbnailLink ? (
                <img src={photo.thumbnailLink} alt={photo.name} loading="lazy" />
              ) : (
                <span>{photo.name}</span>
              )}
            </button>
          ))}
        </div>
        {!loading && photos.length === 0 ? <div className="gallery-loading">Zatím zde nejsou žádné fotky.</div> : null}
        {loading ? <div className="gallery-loading">Načítám fotky…</div> : null}
        {nextPageToken ? (
          <button type="button" className="homepage-cta secondary gallery-load-more" onClick={handleLoadMore} disabled={loading}>
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
              src={activePhoto.fullImageUrl ?? activePhoto.webContentLink ?? activePhoto.thumbnailLink ?? ''}
              alt={activePhoto.name}
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
    if (article || !hasSanityConfig()) {
      return undefined;
    }
    fetchArticleBySlug(slug).then((data) => {
      if (!active || !data) {
        return;
      }
      setArticle(mapSanityArticle(data));
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
  return `${troop.number}. ${troop.name}`;
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

function resolveActiveNav(pathname: string) {
  const normalized = pathname.replace(/\/$/, '') || '/';
  const segments = normalized.split('/').filter(Boolean);
  if (segments.length === 0) {
    return undefined;
  }
  const slug = segments[0];
  if (slug === 'souteze' || slug === 'aplikace' || EVENTS.some((event) => event.slug === slug)) {
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
  if (slug === 'historie') {
    return 'historie';
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
            <p>Krátké reportáže a novinky z posledních závodů a akcí.</p>
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

        <section className="homepage-section" id="souteze" aria-labelledby="souteze-heading">
          <div className="homepage-section-header" style={{ textAlign: 'left', alignItems: 'flex-start', maxWidth: '720px' }}>
            <h2 id="souteze-heading">Soutěže</h2>
            <span className="homepage-section-accent" aria-hidden="true" style={{ alignSelf: 'flex-start' }} />
            <p>Stručný rozcestník k hlavním soutěžím a jejich digitálním aplikacím.</p>
          </div>
          <div className="homepage-card" style={{ maxWidth: '920px', boxShadow: 'none' }}>
            <div className="homepage-souteze-grid">
              <div className="homepage-souteze-block">
                <h3>Soutěže</h3>
                <ul className="homepage-list">
                  {EVENTS.map((event) => (
                    <li key={event.slug}>
                      <a className="homepage-inline-link" href={event.href}>
                        {event.name}
                      </a>
                      <p>{event.description}</p>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="homepage-souteze-block">
                <h3>Aplikace</h3>
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
            <a className="homepage-inline-link" href="/souteze" style={{ marginTop: '12px', display: 'inline-flex' }}>
              Přejít na soutěže a aplikace
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
              <a className="homepage-cta secondary" href="/aktualni-poradi">
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

        <section className="homepage-section" id="oddily" aria-labelledby="oddily-heading">
          <div className="homepage-section-header" style={{ textAlign: 'left', alignItems: 'flex-start', maxWidth: '720px' }}>
            <h2 id="oddily-heading">Oddíly SPTO</h2>
            <span className="homepage-section-accent" aria-hidden="true" style={{ alignSelf: 'flex-start' }} />
            <p>Čtyři oddíly na ukázku – další najdeš v kompletním seznamu.</p>
          </div>
          <div className="homepage-troop-grid">
            {TROOP_HIGHLIGHTS.map((troop) => (
              <a key={troop.href} className="homepage-troop-card" href={troop.href}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <h3>{formatTroopName(troop)}</h3>
                  <span className="homepage-troop-city">{troop.leader}</span>
                </div>
                <p
                  style={{
                    display: '-webkit-box',
                    WebkitBoxOrient: 'vertical',
                    WebkitLineClamp: 2,
                    overflow: 'hidden',
                  }}
                >
                  {formatTroopDescription(troop)}
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
                {EVENTS.map((event) => (
                  <li key={event.slug}>
                    <a className="homepage-inline-link" href={event.href}>
                      {event.name}
                    </a>
                    <p>{event.description}</p>
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
  const rows = TROOPS.map((troop) => {
    const scores = LEAGUE_EVENTS.map((event) => CURRENT_LEAGUE_SCORES[troop.href]?.[event] ?? null);
    const hasScores = scores.some((value) => value !== null);
    const total = hasScores ? scores.reduce<number>((sum, value) => sum + (value ?? 0), 0) : null;
    return {
      key: troop.href,
      name: formatTroopName(troop),
      scores,
      total,
    };
  }).sort((a, b) => {
    if (a.total === null && b.total === null) {
      return a.name.localeCompare(b.name, 'cs');
    }
    if (a.total === null) {
      return 1;
    }
    if (b.total === null) {
      return -1;
    }
    return b.total - a.total;
  });
  const hasAnyScores = rows.some((row) => row.total !== null);

  return (
    <SiteShell>
      <main className="homepage-main homepage-single" aria-labelledby="league-heading">
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
                <span key={event} className="homepage-league-score">
                  {event}
                </span>
              ))}
              <span className="homepage-league-score">Celkem</span>
            </div>
            {rows.map((row, index) => (
              <div key={row.key} className="homepage-league-row">
                <span className="homepage-league-name">
                  <strong className="homepage-league-rank">{index + 1}.</strong> {row.name}
                </span>
                {row.scores.map((score, scoreIndex) => (
                  <span key={`${row.key}-${scoreIndex}`} className="homepage-league-score">
                    {score === null ? '—' : score}
                  </span>
                ))}
                <span className="homepage-league-score homepage-league-total">
                  {row.total === null ? '—' : row.total}
                </span>
              </div>
            ))}
          </div>
        </div>
        <div className="homepage-card">
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
    Promise.all([fetchHomepage(), fetchArticles()])
      .then(([homepageData, articlesData]) => {
        if (!active) {
          return;
        }
        setHomepageContent(homepageData);
        if (articlesData.length > 0) {
          setArticles(articlesData.map(mapSanityArticle));
        }
      });
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
    const event = EVENTS.find((item) => item.slug === slug);
    if (event) {
      return <EventPage slug={slug} />;
    }

    if (slug === 'souteze') {
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
        const detailParts = [];
        if (troop.year) {
          detailParts.push(`založeno ${troop.year}`);
        }
        detailParts.push(`vedoucí ${troop.leader}`);
        return (
          <InfoPage
            eyebrow="SPTO · Oddíly"
            title={formatTroopName(troop)}
            lead={detailParts.join(' · ')}
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
            label: formatTroopName(item),
            description: formatTroopDescription(item),
            href: item.href,
          }))}
        />
      );
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
