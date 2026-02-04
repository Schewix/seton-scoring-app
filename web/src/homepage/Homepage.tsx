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
  { id: 'aktualni-poradi', label: 'Aktuální pořadí', href: '/aktualni-poradi' },
  { id: 'clanky', label: 'Články a novinky', href: '/clanky' },
  { id: 'fotogalerie', label: 'Fotogalerie', href: '/fotogalerie' },
  { id: 'souteze', label: 'Soutěže', href: '/souteze' },
  { id: 'oddily', label: 'Oddíly SPTO', href: '/oddily' },
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
type LeagueScoresRecord = Record<string, Partial<Record<LeagueEvent, number>>>;
type LeagueScoreEntry = {
  troop_id: string;
  event_key: string;
  points: number | string | null;
};

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
  source: 'pionyr' | 'local';
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
  baseTitle?: string;
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

function stripHtmlToText(html: string) {
  if (!html) {
    return '';
  }
  if (typeof DOMParser === 'undefined') {
    return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  }
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return (doc.body?.textContent ?? '').replace(/\s+/g, ' ').trim();
}

function buildExcerptFromBody(
  body: Article['body'],
  bodyFormat?: Article['bodyFormat'] | null,
  maxLength = 180,
) {
  if (!body) {
    return '';
  }
  let text = '';
  if (typeof body === 'string') {
    if (bodyFormat === 'html' || body.trim().startsWith('<')) {
      text = stripHtmlToText(body);
    } else {
      text = body;
    }
  } else if (Array.isArray(body)) {
    text = body.filter((chunk): chunk is string => typeof chunk === 'string').join(' ');
  }
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return '';
  }
  if (normalized.length <= maxLength) {
    return normalized;
  }
  const sliced = normalized.slice(0, maxLength + 1);
  const safeCut = sliced.lastIndexOf(' ');
  return `${sliced.slice(0, safeCut > 0 ? safeCut : maxLength).trim()}…`;
}

type ExtractedArticlePhoto = {
  src: string;
  alt: string;
};

function extractArticlePhotos(html: string) {
  if (!html || typeof DOMParser === 'undefined') {
    return { html, photos: [] as ExtractedArticlePhoto[] };
  }
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const images = Array.from(doc.querySelectorAll('img'));
  const photos = images
    .map((img) => {
      const src = img.getAttribute('src') ?? '';
      if (!src) {
        return null;
      }
      return {
        src,
        alt: img.getAttribute('alt') ?? '',
      };
    })
    .filter((photo): photo is ExtractedArticlePhoto => Boolean(photo));
  images.forEach((img) => {
    const figure = img.closest('figure');
    if (figure) {
      figure.remove();
    } else {
      img.remove();
    }
  });
  return { html: doc.body.innerHTML, photos };
}

function toDriveSizedUrl(url: string, size: number) {
  let output = url.replace(/=s\d+(-c)?/g, `=w${size}`);
  output = output.replace(/=w\d+-h\d+(-c)?/g, `=w${size}`);
  return output;
}

function toProxyImageUrl(url: string, size: number) {
  const cleaned = url.replace(/^https?:\/\//, '');
  const encoded = encodeURIComponent(cleaned);
  return `https://images.weserv.nl/?url=${encoded}&w=${size}&h=${size}&fit=cover&output=webp&q=80`;
}

function extractDriveFileId(url: string) {
  const match = url.match(/\/d\/([a-zA-Z0-9_-]+)/) || url.match(/id=([a-zA-Z0-9_-]+)/);
  return match?.[1] ?? null;
}

function getArticleThumbUrl(url: string, size: number) {
  if (!url) {
    return '';
  }
  if (url.includes('pionyr.cz/')) {
    return url;
  }
  if (url.includes('drive.google.com/thumbnail')) {
    return toDriveSizedUrl(url, size);
  }
  if (url.includes('drive.google.com') || url.includes('googleusercontent.com')) {
    const id = extractDriveFileId(url);
    if (id) {
      return `https://drive.google.com/thumbnail?sz=w${size}&id=${id}`;
    }
  }
  return toProxyImageUrl(url, size);
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
  const excerptValue = (article.excerpt ?? '').trim();
  return {
    source: article.source,
    title: article.title,
    dateISO,
    dateLabel: formatDateLabel(dateISO),
    excerpt: excerptValue || buildExcerptFromBody(article.body ?? null, article.bodyFormat ?? null),
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

function ArticlesIndexPage({
  articles,
  articlesLoading,
}: {
  articles: Article[];
  articlesLoading: boolean;
}) {
  return (
    <SiteShell>
      <main className="homepage-main homepage-single" aria-labelledby="articles-heading">
        <section className="homepage-section" aria-labelledby="articles-heading">
          <div className="homepage-section-header" style={{ textAlign: 'left', alignItems: 'flex-start', maxWidth: '720px' }}>
            <h1 id="articles-heading">Články ze soutěží</h1>
            <span className="homepage-section-accent" aria-hidden="true" style={{ alignSelf: 'flex-start' }} />
          </div>
          <p className="homepage-lead" style={{ maxWidth: '720px' }}>
            {articlesLoading ? 'Načítám články z redakce…' : 'Reportáže a novinky z posledních akcí.'}
          </p>
          {articlesLoading ? (
            <div className="homepage-card" style={{ maxWidth: '720px' }}>
              <p style={{ margin: 0 }}>Načítám články z redakce…</p>
            </div>
          ) : articles.length > 0 ? (
            <div className="homepage-article-grid">
              {articles.map((article) => (
                <article key={article.href} className="homepage-article-card">
                  <div className="homepage-article-row">
                    <div className={`homepage-article-thumb${article.coverImage?.url ? '' : ' is-empty'}`}>
                      {article.coverImage?.url ? (
                        <img
                          src={getArticleThumbUrl(article.coverImage.url, 360)}
                          alt={article.coverImage.alt ?? article.title}
                          loading="lazy"
                          decoding="async"
                          fetchPriority="low"
                        />
                      ) : (
                        <span aria-hidden="true">SPTO</span>
                      )}
                    </div>
                    <div className="homepage-article-body">
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
                          WebkitLineClamp: 3,
                          overflow: 'hidden',
                        }}
                      >
                        {article.excerpt}
                      </p>
                      <a className="homepage-inline-link" href={article.href} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                        Číst článek <span aria-hidden="true">→</span>
                      </a>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="homepage-card" style={{ maxWidth: '720px' }}>
              <p style={{ margin: 0 }}>Zatím tu není žádný článek z redakce.</p>
            </div>
          )}
        </section>
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
  const htmlBody = isHtmlBody && typeof article.body === 'string' ? article.body : null;
  const extracted = htmlBody ? extractArticlePhotos(htmlBody) : null;
  const articleHtml = extracted?.html ?? htmlBody;
  const sidePhotos = extracted?.photos ?? [];
  const coverImage = article.coverImage?.url
    ? { src: article.coverImage.url, alt: article.coverImage.alt ?? article.title }
    : null;
  const mediaItems = [
    ...(coverImage ? [coverImage] : []),
    ...sidePhotos.filter((photo) => photo.src !== coverImage?.src),
  ];
  const hasMedia = mediaItems.length > 0;
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
        <div className={`homepage-card${hasMedia ? ' homepage-article-layout' : ''}`}>
          <div className="homepage-article-text">
            {isPortableText ? (
              <PortableText value={article.body as any[]} components={portableTextComponents} />
            ) : articleHtml ? (
              <div className="homepage-article-html" dangerouslySetInnerHTML={{ __html: articleHtml }} />
            ) : textParagraphs.length > 0 ? (
              textParagraphs.map((paragraph, index) => <p key={`${article.href}-${index}`}>{paragraph}</p>)
            ) : Array.isArray(article.body) ? (
              (article.body as string[]).map((paragraph, index) => (
                <p key={`${article.href}-${index}`}>{paragraph}</p>
              ))
            ) : null}
            {article.author ? <p style={{ marginTop: '24px', fontWeight: 600 }}>{article.author}</p> : null}
          </div>
          {hasMedia ? (
            <aside className="homepage-article-photos" aria-label="Fotografie k článku">
              {mediaItems.map((photo, index) => (
                <img
                  key={`${article.href}-photo-${index}`}
                  className={index === 0 && coverImage ? 'homepage-article-cover' : undefined}
                  src={photo.src}
                  alt={photo.alt}
                  loading="lazy"
                  decoding="async"
                />
              ))}
            </aside>
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
  const [leagueScores, setLeagueScores] = useState<LeagueScoresRecord>(cloneLeagueScores(CURRENT_LEAGUE_SCORES));
  const [leagueMessage, setLeagueMessage] = useState<string | null>(null);
  const [leagueSaving, setLeagueSaving] = useState(false);
  const [albumTitleAlbums, setAlbumTitleAlbums] = useState<DriveAlbum[]>([]);
  const [albumTitleEdits, setAlbumTitleEdits] = useState<Record<string, string>>({});
  const [albumTitleOriginals, setAlbumTitleOriginals] = useState<Record<string, string>>({});
  const [albumTitleMessage, setAlbumTitleMessage] = useState<string | null>(null);
  const [albumTitleLoading, setAlbumTitleLoading] = useState(false);
  const [albumTitleSaving, setAlbumTitleSaving] = useState(false);

  const loadArticles = () =>
    fetch('/api/content/admin/articles', { credentials: 'include' })
      .then((response) => (response.ok ? response.json() : Promise.reject()))
      .then((data) => {
        setArticles(data.articles ?? []);
      })
      .catch(() => {
        setArticles([]);
      });

  const loadLeagueScores = () =>
    fetch('/api/content/admin/league', { credentials: 'include' })
      .then((response) => (response.ok ? response.json() : Promise.reject()))
      .then((data) => {
        const entries = Array.isArray(data.scores) ? (data.scores as LeagueScoreEntry[]) : [];
        setLeagueScores(buildLeagueScoreRecord(entries, CURRENT_LEAGUE_SCORES));
      })
      .catch(() => {
        setLeagueScores(cloneLeagueScores(CURRENT_LEAGUE_SCORES));
      });

  const loadAlbumTitles = () => {
    setAlbumTitleLoading(true);
    setAlbumTitleMessage(null);
    return Promise.all([
      fetch('/api/gallery/albums?nocache=1')
        .then((response) => (response.ok ? response.json() : Promise.reject()))
        .then((data) => (data.albums ?? []) as DriveAlbum[]),
      fetch('/api/content/admin/albums', { credentials: 'include' })
        .then((response) => (response.ok ? response.json() : Promise.reject()))
        .then((data) => (data.items ?? []) as Array<{ folder_id: string; title: string }>),
    ])
      .then(([albumsData, overrides]) => {
        const overrideMap: Record<string, string> = {};
        overrides.forEach((row) => {
          if (row.folder_id && typeof row.title === 'string') {
            overrideMap[row.folder_id] = row.title;
          }
        });
        const nextEdits: Record<string, string> = {};
        albumsData.forEach((album) => {
          const override = overrideMap[album.folderId];
          if (override) {
            nextEdits[album.folderId] = override;
          }
        });
        setAlbumTitleAlbums(albumsData);
        setAlbumTitleOriginals(overrideMap);
        setAlbumTitleEdits(nextEdits);
      })
      .catch(() => {
        setAlbumTitleAlbums([]);
        setAlbumTitleOriginals({});
        setAlbumTitleEdits({});
        setAlbumTitleMessage('Nepodařilo se načíst názvy alb.');
      })
      .finally(() => {
        setAlbumTitleLoading(false);
      });
  };

  useEffect(() => {
    let active = true;
    fetch('/api/content/admin/session', { credentials: 'include' })
      .then((response) => {
        if (!active) return;
        setSession(response.ok ? 'auth' : 'unauth');
        if (response.ok) {
          loadArticles();
          loadLeagueScores();
          loadAlbumTitles();
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
        loadLeagueScores();
        loadAlbumTitles();
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
      setLeagueScores(cloneLeagueScores(CURRENT_LEAGUE_SCORES));
      setLeagueMessage(null);
      setAlbumTitleAlbums([]);
      setAlbumTitleEdits({});
      setAlbumTitleOriginals({});
      setAlbumTitleMessage(null);
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

  const updateLeagueScore = (troopId: string, eventKey: LeagueEvent, rawValue: string) => {
    const normalized = rawValue.replace(',', '.').trim();
    const parsed = normalized.length > 0 ? Number(normalized) : null;
    const nextValue = parsed !== null && Number.isFinite(parsed) ? parsed : null;
    setLeagueScores((prev) => ({
      ...prev,
      [troopId]: {
        ...(prev[troopId] ?? {}),
        [eventKey]: nextValue,
      },
    }));
    setLeagueMessage(null);
  };

  const updateAlbumTitle = (folderId: string, value: string) => {
    setAlbumTitleEdits((prev) => ({ ...prev, [folderId]: value }));
    setAlbumTitleMessage(null);
  };

  const handleLeagueSave = () => {
    setLeagueMessage(null);
    setLeagueSaving(true);
    const payloadScores = LEAGUE_TROOPS.flatMap((troop) =>
      LEAGUE_EVENTS.map((event) => ({
        troop_id: troop.id,
        event_key: event.key,
        points: leagueScores[troop.id]?.[event.key] ?? null,
      })),
    );
    fetch('/api/content/admin/league', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ scores: payloadScores }),
    })
      .then((response) => {
        if (!response.ok) {
          throw new Error('Uložení se nezdařilo.');
        }
        setLeagueMessage('Tabulka byla uložena.');
        return loadLeagueScores();
      })
      .catch((error) => {
        setLeagueMessage(error instanceof Error ? error.message : 'Uložení se nezdařilo.');
      })
      .finally(() => {
        setLeagueSaving(false);
      });
  };

  const handleAlbumTitleSave = () => {
    setAlbumTitleMessage(null);
    setAlbumTitleSaving(true);
    const baseTitles = new Map(
      albumTitleAlbums.map((album) => [album.folderId, album.baseTitle ?? album.title]),
    );
    const upserts: Array<{ folder_id: string; title: string }> = [];
    const deletes: string[] = [];

    for (const [folderId, baseTitle] of baseTitles.entries()) {
      const rawEdit = albumTitleEdits[folderId] ?? '';
      const normalized = rawEdit.trim();
      const originalOverride = albumTitleOriginals[folderId];
      if (!normalized || normalized === baseTitle) {
        if (originalOverride) {
          deletes.push(folderId);
        }
        continue;
      }
      if (originalOverride && originalOverride === normalized) {
        continue;
      }
      upserts.push({ folder_id: folderId, title: normalized });
    }

    if (upserts.length === 0 && deletes.length === 0) {
      setAlbumTitleSaving(false);
      setAlbumTitleMessage('Žádné změny k uložení.');
      return;
    }

    fetch('/api/content/admin/albums', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ items: upserts, remove: deletes }),
    })
      .then((response) => {
        if (!response.ok) {
          throw new Error('Uložení se nezdařilo.');
        }
        setAlbumTitleMessage('Názvy alb byly uloženy.');
        return loadAlbumTitles();
      })
      .catch((error) => {
        setAlbumTitleMessage(error instanceof Error ? error.message : 'Uložení se nezdařilo.');
      })
      .finally(() => {
        setAlbumTitleSaving(false);
      });
  };

  const leagueGridTemplate = `minmax(220px, 1.4fr) repeat(${LEAGUE_EVENTS.length}, minmax(90px, 0.8fr)) minmax(90px, 0.8fr)`;
  const leagueRows = addCompetitionRanks(buildLeagueRows(leagueScores));
  const albumTitleGroups = useMemo(() => {
    const groups = new Map<string, DriveAlbum[]>();
    albumTitleAlbums.forEach((album) => {
      const yearKey = album.year || 'Ostatní';
      if (!groups.has(yearKey)) {
        groups.set(yearKey, []);
      }
      groups.get(yearKey)!.push(album);
    });
    groups.forEach((items) => items.sort((a, b) => a.title.localeCompare(b.title, 'cs')));
    return Array.from(groups.entries()).sort((a, b) => b[0].localeCompare(a[0], 'cs'));
  }, [albumTitleAlbums]);

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
          <>
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
                  {articles.length === 0 ? (
                    <li className="editor-empty">Zatím tu nejsou žádné články. Klikni na „Nový“ a založ první.</li>
                  ) : (
                    articles.map((article) => (
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
                    ))
                  )}
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

            <div className="homepage-card editor-league">
              <div className="editor-league-toolbar">
                <div>
                  <h2>Aktuální pořadí Zelené ligy</h2>
                  <p>Uprav body oddílů v jednotlivých soutěžích. Celkové pořadí se přepočítá automaticky.</p>
                </div>
                <div className="editor-league-actions">
                  <button type="button" className="homepage-button" onClick={handleLeagueSave} disabled={leagueSaving}>
                    {leagueSaving ? 'Ukládám…' : 'Uložit tabulku'}
                  </button>
                </div>
              </div>
              {leagueMessage ? <p className="homepage-alert">{leagueMessage}</p> : null}
              <div className="editor-league-table" style={{ '--league-editor-grid': leagueGridTemplate } as React.CSSProperties}>
                <div className="editor-league-row editor-league-row--header">
                  <span>Oddíl</span>
                  {LEAGUE_EVENTS.map((event) => (
                    <span key={event.key} className="editor-league-score">
                      {event.label}
                    </span>
                  ))}
                  <span className="editor-league-score">Celkem</span>
                </div>
                {leagueRows.map((row) => (
                  <div key={row.key} className="editor-league-row">
                    <span className="editor-league-name">{row.name}</span>
                    {LEAGUE_EVENTS.map((event) => {
                      const value = leagueScores[row.key]?.[event.key];
                      return (
                        <label key={`${row.key}-${event.key}`} className="editor-league-input">
                          <input
                            type="number"
                            inputMode="decimal"
                            step="0.1"
                            min="0"
                            value={value ?? ''}
                            onChange={(eventChange) =>
                              updateLeagueScore(row.key, event.key, eventChange.target.value)
                            }
                            aria-label={`${row.name} – ${event.label}`}
                          />
                        </label>
                      );
                    })}
                    <span className="editor-league-total">{formatLeagueScore(row.total)}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="homepage-card editor-albums">
              <div className="editor-albums-header">
                <div>
                  <h2>Názvy alb</h2>
                  <p>Uprav zobrazované názvy alb ve fotogalerii. Původní názvy na Drive zůstanou zachované.</p>
                </div>
                <div className="editor-albums-actions">
                  <button
                    type="button"
                    className="homepage-button homepage-button--ghost"
                    onClick={loadAlbumTitles}
                    disabled={albumTitleLoading || albumTitleSaving}
                  >
                    Obnovit
                  </button>
                  <button
                    type="button"
                    className="homepage-button"
                    onClick={handleAlbumTitleSave}
                    disabled={albumTitleLoading || albumTitleSaving}
                  >
                    {albumTitleSaving ? 'Ukládám…' : 'Uložit názvy'}
                  </button>
                </div>
              </div>
              {albumTitleMessage ? <p className="homepage-alert">{albumTitleMessage}</p> : null}
              {albumTitleLoading ? <div className="editor-albums-loading">Načítám alba…</div> : null}
              {!albumTitleLoading && albumTitleAlbums.length === 0 ? (
                <div className="editor-albums-loading">Žádná alba k úpravě.</div>
              ) : null}
              {!albumTitleLoading && albumTitleAlbums.length > 0 ? (
                <div className="editor-albums-groups">
                  {albumTitleGroups.map(([year, items]) => (
                    <section key={year} className="editor-albums-year">
                      <h3>{year}</h3>
                      <div className="editor-albums-list">
                        {items.map((album) => {
                          const baseTitle = album.baseTitle ?? album.title;
                          const editValue = albumTitleEdits[album.folderId] ?? '';
                          const normalizedEdit = editValue.trim();
                          const displayTitle = normalizedEdit || baseTitle;
                          const isOverride = normalizedEdit.length > 0 && normalizedEdit !== baseTitle;
                          return (
                            <div key={album.folderId} className="editor-album-row">
                              <div className="editor-album-info">
                                <strong>{displayTitle}</strong>
                                <span className="editor-album-meta">
                                  {isOverride ? `Původní název: ${baseTitle}` : `Původní název: ${baseTitle}`}
                                </span>
                              </div>
                              <input
                                type="text"
                                value={editValue}
                                onChange={(event) => updateAlbumTitle(album.folderId, event.target.value)}
                                placeholder="Nechat původní"
                                aria-label={`Zobrazovaný název alba ${baseTitle}`}
                              />
                            </div>
                          );
                        })}
                      </div>
                    </section>
                  ))}
                </div>
              ) : null}
            </div>
          </>
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

  useEffect(() => {
    if (lightboxIndex === null) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setLightboxIndex(null);
        return;
      }
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        setLightboxIndex((prev) => (prev !== null && prev > 0 ? prev - 1 : prev));
        return;
      }
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        setLightboxIndex((prev) => (prev !== null && prev < photos.length - 1 ? prev + 1 : prev));
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [lightboxIndex, photos.length]);

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
    if (article && (article.source === 'local' || (article.body && article.body.length > 0))) {
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

function cloneLeagueScores(source: LeagueScoresRecord): LeagueScoresRecord {
  const next: LeagueScoresRecord = {};
  Object.entries(source).forEach(([troopId, scores]) => {
    next[troopId] = { ...(scores ?? {}) };
  });
  return next;
}

function buildLeagueScoreRecord(
  entries: LeagueScoreEntry[] | null | undefined,
  fallback: LeagueScoresRecord,
): LeagueScoresRecord {
  if (!entries || entries.length === 0) {
    return cloneLeagueScores(fallback);
  }
  const record: LeagueScoresRecord = {};
  LEAGUE_TROOPS.forEach((troop) => {
    record[troop.id] = {};
  });
  entries.forEach((entry) => {
    const troopId = entry?.troop_id;
    const eventKey = entry?.event_key;
    if (!troopId || !eventKey) {
      return;
    }
    const valueRaw = entry.points;
    let value: number | null = null;
    if (typeof valueRaw === 'number') {
      value = Number.isFinite(valueRaw) ? valueRaw : null;
    } else if (typeof valueRaw === 'string') {
      const parsed = Number(valueRaw.replace(',', '.'));
      value = Number.isFinite(parsed) ? parsed : null;
    } else if (valueRaw === null || valueRaw === undefined) {
      value = null;
    }
    if (!record[troopId]) {
      record[troopId] = {};
    }
    record[troopId][eventKey as LeagueEvent] = value;
  });
  return record;
}

function buildLeagueRows(scores: LeagueScoresRecord = CURRENT_LEAGUE_SCORES): LeagueRow[] {
  return LEAGUE_TROOPS.map((troop, index) => {
    const troopScores = scores[troop.id] ?? {};
    const scoreValues = LEAGUE_EVENTS.map((event) => troopScores[event.key] ?? null);
    const hasScores = scoreValues.some((value) => value !== null);
    const total = hasScores ? scoreValues.reduce<number>((sum, value) => sum + (value ?? 0), 0) : null;
    return {
      key: troop.id,
      name: troop.name,
      scores: scoreValues,
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
  articlesLoading,
  leagueScores,
}: {
  homepageContent: SanityHomepage | null;
  articles: Article[];
  articlesLoading: boolean;
  leagueScores: LeagueScoresRecord;
}) {
  const headerTitle = homepageContent?.heroTitle ?? undefined;
  const headerSubtitle = homepageContent?.heroSubtitle ?? undefined;
  const homepageArticles = articles.slice(0, 4);

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
          {articlesLoading ? (
            <div className="homepage-card" style={{ maxWidth: '720px' }}>
              <p style={{ margin: 0 }}>Načítám články z redakce…</p>
            </div>
          ) : homepageArticles.length > 0 ? (
            <div className="homepage-article-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
              {homepageArticles.map((article) => (
                <article key={article.title} className="homepage-article-card" style={{ minHeight: '220px' }}>
                  <div className="homepage-article-row">
                    <div className={`homepage-article-thumb${article.coverImage?.url ? '' : ' is-empty'}`}>
                      {article.coverImage?.url ? (
                        <img
                          src={getArticleThumbUrl(article.coverImage.url, 360)}
                          alt={article.coverImage.alt ?? article.title}
                          loading="lazy"
                          decoding="async"
                          fetchPriority="low"
                        />
                      ) : (
                        <span aria-hidden="true">SPTO</span>
                      )}
                    </div>
                    <div className="homepage-article-body">
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
                    </div>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="homepage-card" style={{ maxWidth: '720px' }}>
              <p style={{ margin: 0 }}>Zatím tu není žádný článek z redakce.</p>
            </div>
          )}
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
                {addCompetitionRanks(buildLeagueRows(leagueScores))
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

function LeagueStandingsPage({ leagueScores }: { leagueScores: LeagueScoresRecord }) {
  const leagueGridTemplate = `minmax(220px, 1.3fr) repeat(${LEAGUE_EVENTS.length}, minmax(90px, 1fr)) minmax(90px, 0.8fr)`;
  const rows = addCompetitionRanks(buildLeagueRows(leagueScores));
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
  const [articles, setArticles] = useState<Article[]>([]);
  const [articlesLoading, setArticlesLoading] = useState(false);
  const [leagueScores, setLeagueScores] = useState<LeagueScoresRecord>(cloneLeagueScores(CURRENT_LEAGUE_SCORES));
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
    setArticlesLoading(true);
    fetchContentArticles()
      .then((articlesData) => {
        if (!active) {
          return;
        }
        setArticles(articlesData.map(mapContentArticle));
      })
      .catch(() => {
        if (active) {
          setArticles([]);
        }
      })
      .finally(() => {
        if (active) {
          setArticlesLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    fetch('/api/content/league')
      .then((response) => (response.ok ? response.json() : Promise.reject()))
      .then((data) => {
        if (!active) {
          return;
        }
        const entries = Array.isArray(data.scores) ? (data.scores as LeagueScoreEntry[]) : [];
        setLeagueScores(buildLeagueScoreRecord(entries, CURRENT_LEAGUE_SCORES));
      })
      .catch(() => {
        if (active) {
          setLeagueScores(cloneLeagueScores(CURRENT_LEAGUE_SCORES));
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
        articlesLoading={articlesLoading}
        leagueScores={leagueScores}
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
      return <LeagueStandingsPage leagueScores={leagueScores} />;
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
      return <ArticlesIndexPage articles={articles} articlesLoading={articlesLoading} />;
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
