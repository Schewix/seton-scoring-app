import './Homepage.css';
import { useEffect, useMemo, useState } from 'react';
import type { MouseEvent } from 'react';
import { PortableText } from '@portabletext/react';
import AppFooter from '../components/AppFooter';
import logo from '../assets/znak_SPTO_transparent.png';
import {
  fetchAlbumBySlug,
  fetchAlbums,
  fetchArticleBySlug,
  fetchArticles,
  fetchHomepage,
  hasSanityConfig,
  type SanityAlbum,
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

function GalleryAlbumCard({ album }: { album: SanityAlbum }) {
  const [preview, setPreview] = useState<GalleryPreview | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let active = true;
    if (!album.driveFolderId) {
      return undefined;
    }
    setLoading(true);
    fetchAlbumPreview(album.driveFolderId)
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

  const coverUrl =
    album.coverImage?.url ?? preview?.files?.find((file) => file.thumbnailLink)?.thumbnailLink ?? null;
  const previewPhotos = preview?.files ?? [];

  return (
    <a className="gallery-album-card" href={`/fotogalerie/${album.slug}`}>
      <div className="gallery-album-cover">
        {coverUrl ? (
          <img src={coverUrl} alt={album.coverImage?.alt ?? album.title} loading="lazy" />
        ) : (
          <div className="gallery-album-cover-placeholder" />
        )}
        <span className="gallery-album-date">{formatDateLabel(album.date)}</span>
      </div>
      <div className="gallery-album-body">
        <div>
          <h3>{album.title}</h3>
          <p>{album.schoolYear}</p>
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

function GalleryOverviewPage({ albums, loading }: { albums: SanityAlbum[]; loading: boolean }) {
  const grouped = useMemo(() => {
    const groups = new Map<string, SanityAlbum[]>();
    albums.forEach((album) => {
      const key = album.schoolYear || 'Ostatní';
      if (!groups.has(key)) {
        groups.set(key, []);
      }
      groups.get(key)!.push(album);
    });
    groups.forEach((items) => items.sort((a, b) => b.date.localeCompare(a.date)));
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

function GalleryAlbumPage({ slug, albums }: { slug: string; albums: SanityAlbum[] }) {
  const [album, setAlbum] = useState<SanityAlbum | null>(() => albums.find((item) => item.slug === slug) ?? null);
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
    if (album || !slug) {
      return undefined;
    }
    fetchAlbumBySlug(slug).then((data) => {
      if (active) {
        setAlbum(data);
      }
    });
    return () => {
      active = false;
    };
  }, [album, slug]);

  useEffect(() => {
    let active = true;
    if (!album?.driveFolderId) {
      return undefined;
    }
    setLoading(true);
    const params = new URLSearchParams({ folderId: album.driveFolderId, pageSize: '36' });
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
    if (!album?.driveFolderId || !nextPageToken || loading) {
      return;
    }
    setLoading(true);
    const params = new URLSearchParams({
      folderId: album.driveFolderId,
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
    return <NotFoundPage />;
  }

  return (
    <SiteShell>
      <main className="homepage-main homepage-single" aria-labelledby="album-heading">
        <p className="homepage-eyebrow">SPTO · Fotogalerie</p>
        <h1 id="album-heading">{album.title}</h1>
        <p className="homepage-lead">
          {formatDateLabel(album.date)} · {album.schoolYear}
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

function SiteHeader({
  activeSection,
  onNavClick,
  title,
  subtitle,
}: {
  activeSection?: string;
  onNavClick?: (id: string) => (event: MouseEvent<HTMLAnchorElement>) => void;
  title?: string;
  subtitle?: string;
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
            <h1>{title ?? 'SPTO a Zelená liga'}</h1>
            <p className="homepage-subtitle">{subtitle ?? HEADER_SUBTITLE}</p>
          </div>
          <div className="homepage-cta-group" role="group" aria-label="Hlavní odkazy">
            <a className="homepage-cta primary" href="/zelena-liga">
              Aktuální pořadí Zelené ligy
            </a>
            <a className="homepage-cta primary" href="/aplikace">
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
  headerTitle,
  headerSubtitle,
}: {
  children: React.ReactNode;
  activeSection?: string;
  onNavClick?: (id: string) => (event: MouseEvent<HTMLAnchorElement>) => void;
  headerTitle?: string;
  headerSubtitle?: string;
}) {
  return (
    <div className="homepage-shell" style={{ scrollBehavior: 'smooth' }}>
      <SiteHeader
        activeSection={activeSection}
        onNavClick={onNavClick}
        title={headerTitle}
        subtitle={headerSubtitle}
      />
      {children}
      <AppFooter className="homepage-footer" />
    </div>
  );
}

function Homepage({
  homepageContent,
  articles,
  featuredPreview,
}: {
  homepageContent: SanityHomepage | null;
  articles: Article[];
  featuredPreview: GalleryPreview | null;
}) {
  const previewPhotos = featuredPreview?.files?.length
    ? featuredPreview.files
        .filter((file) => Boolean(file.thumbnailLink))
        .map((file) => ({
          id: file.fileId,
          src: file.thumbnailLink ?? '',
          alt: file.name,
        }))
    : GALLERY_PREVIEW;
  const [featuredPhoto, ...galleryThumbnails] = previewPhotos;
  const [activeSection, setActiveSection] = useState('');
  const headerTitle = homepageContent?.heroTitle ?? undefined;
  const headerSubtitle = homepageContent?.heroSubtitle ?? undefined;

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
    <SiteShell
      activeSection={activeSection}
      onNavClick={handleNavClick}
      headerTitle={headerTitle ?? undefined}
      headerSubtitle={headerSubtitle ?? undefined}
    >
      <main className="homepage-main" aria-labelledby="homepage-intro-heading" style={{ maxWidth: '1120px', gap: '64px' }}>
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

        <section className="homepage-section" id="fotogalerie" aria-labelledby="fotogalerie-heading">
          <div className="homepage-section-header" style={{ textAlign: 'left', alignItems: 'flex-start', maxWidth: '720px' }}>
            <h2 id="fotogalerie-heading">Fotogalerie</h2>
            <span className="homepage-section-accent" aria-hidden="true" style={{ alignSelf: 'flex-start' }} />
            {homepageContent?.galleryIntro?.length ? (
              <PortableText value={homepageContent.galleryIntro} components={portableTextComponents} />
            ) : (
              <p>Malý výběr z poslední akce – kompletní alba najdeš ve fotogalerii.</p>
            )}
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
                Kompletní galerie: <a href="/fotogalerie">/fotogalerie</a>, detail alba: <a href="/fotogalerie/setonuv-zavod-2025">/fotogalerie/[slug]</a>
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
  const [albums, setAlbums] = useState<SanityAlbum[]>([]);
  const [albumsLoading, setAlbumsLoading] = useState(false);
  const [featuredPreview, setFeaturedPreview] = useState<GalleryPreview | null>(null);
  const path = window.location.pathname.replace(/\/$/, '') || '/';
  const segments = path.split('/').filter(Boolean);

  useEffect(() => {
    if (!hasSanityConfig()) {
      return;
    }
    let active = true;
    setAlbumsLoading(true);
    Promise.all([fetchHomepage(), fetchArticles(), fetchAlbums()])
      .then(([homepageData, articlesData, albumsData]) => {
        if (!active) {
          return;
        }
        setHomepageContent(homepageData);
        if (articlesData.length > 0) {
          setArticles(articlesData.map(mapSanityArticle));
        }
        setAlbums(albumsData);
      })
      .finally(() => {
        if (active) {
          setAlbumsLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    const folderId = homepageContent?.featuredAlbum?.driveFolderId;
    if (!folderId) {
      return undefined;
    }
    fetchAlbumPreview(folderId)
      .then((data) => {
        if (active) {
          setFeaturedPreview(data);
        }
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [homepageContent?.featuredAlbum?.driveFolderId]);

  if (path === '/') {
    return (
      <Homepage
        homepageContent={homepageContent}
        articles={articles}
        featuredPreview={featuredPreview}
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
        return <GalleryAlbumPage slug={albumSlug} albums={albums} />;
      }
      return <GalleryOverviewPage albums={albums} loading={albumsLoading} />;
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
