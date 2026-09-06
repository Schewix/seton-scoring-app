import './Homepage.css';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type SyntheticEvent,
} from 'react';
import { PortableText } from '@portabletext/react';
import AppFooter from '../components/AppFooter';
import logo from '../assets/znak_SPTO_transparent.png';
import { fetchContentArticle, fetchContentArticles, type ContentArticle } from '../data/content';
import { fetchHomepage, hasSanityConfig, type SanityHomepage } from '../data/sanity';
import { fetchAlbumPreview, type GalleryPreview as CachedGalleryPreview } from '../utils/galleryCache';
import { supabase } from '../supabaseClient';
import SecretMenuGame from '../secretMenu/SecretMenuGame';
import {
  AFTERPARTY_DRINK_BY_KEY,
  AFTERPARTY_DRINK_ITEMS,
  AFTERPARTY_DRINK_MENU,
  calculateAfterpartyPoints,
  createEmptyAfterpartyCounts,
} from '../afterparty';

const HOMEPAGE_GALLERY_PREFETCH_LIMIT = 3;
const HOMEPAGE_GALLERY_PREFETCH_DELAY_MS = 900;

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
    ruleMatchers: ['pravidla-souteze', 'pravidla-stanovist', 'zelena-liga', 'stavba-stanu'],
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
  { id: 'domu', label: 'Domů', href: '/' },
  { id: 'plan-akci', label: 'Plán akcí', href: '/plan-akci' },
  { id: 'aktualni-poradi', label: 'Aktuální pořadí', href: '/aktualni-poradi' },
  { id: 'clanky', label: 'Články a novinky', href: '/clanky' },
  { id: 'fotogalerie', label: 'Fotogalerie', href: '/fotogalerie' },
  { id: 'souteze', label: 'Soutěže', href: '/souteze' },
  { id: 'oddily', label: 'Oddíly SPTO', href: '/oddily' },
  { id: 'o-spto', label: 'O SPTO', href: '/o-spto' },
  { id: 'kontakty', label: 'Kontakty', href: '/kontakty' },
];

type ScheduleEventKind = 'event' | 'assembly' | 'staff';

type ScheduleEvent = {
  name: string;
  start: string;
  end?: string;
  kind: ScheduleEventKind;
  note?: string;
  href?: string;
};

const SCHOOL_YEAR_EVENTS: ScheduleEvent[] = [
  { name: 'Sněm SPTO', start: '2026-09-08', kind: 'assembly' },
  { name: 'ZaPsem', start: '2026-10-03', kind: 'event' },
  { name: 'Štáb SPTO', start: '2026-10-13', kind: 'staff' },
  { name: 'Štáb SPTO', start: '2026-11-10', kind: 'staff' },
  { name: 'Štáb SPTO', start: '2026-12-08', kind: 'staff' },
  { name: 'Sněm SPTO', start: '2027-01-12', kind: 'assembly' },
  { name: 'Štáb SPTO', start: '2027-02-02', kind: 'staff' },
  { name: 'Deskové hry', start: '2027-02-13', kind: 'event', href: '/souteze/deskove-hry' },
  { name: 'Sněm SPTO', start: '2027-03-09', kind: 'assembly' },
  { name: 'Štáb SPTO', start: '2027-04-06', kind: 'staff' },
  { name: 'Setonův závod', start: '2027-04-24', kind: 'event', href: '/souteze/setonuv-zavod' },
  { name: 'Štáb SPTO', start: '2027-05-04', kind: 'staff' },
  { name: 'Sraz PTO', start: '2027-05-21', end: '2027-05-23', kind: 'event' },
  { name: 'Sněm SPTO', start: '2027-06-15', kind: 'assembly', note: 'Grilovací sněm' },
];

const SCHEDULE_KIND_LABELS: Record<ScheduleEventKind, string> = {
  event: 'Akce',
  assembly: 'Sněm',
  staff: 'Štáb',
};

type LeagueEventEntry = {
  key: string;
  label: string;
  name: string;
  order?: number;
};

const LEAGUE_EVENTS: LeagueEventEntry[] = [
  { key: 'pto-ob', label: 'PTOB', name: 'Orientační běh' },
  { key: 'ds', label: 'DS', name: 'Dračí smyčka' },
  { key: 'kp', label: 'KP', name: 'Kosmův prostor' },
  { key: 'zls', label: 'Seton', name: 'Setonův závod' },
];
const LEAGUE_TOP_COUNT = 7;
const AFTERPARTY_STORAGE_KEY = 'zl-afterparty-counter-v2';
const AFTERPARTY_PARTICIPANT_STORAGE_KEY = 'zl-afterparty-participant-v1';
const AFTERPARTY_RECEIPTS_BUCKET = 'afterparty-receipts';
const CONTENT_ARTICLE_IMAGES_BUCKET = 'content-article-images';
const CONTENT_ARTICLE_ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const;
const CONTENT_ARTICLE_FONT_SIZE_OPTIONS = [
  { value: '2', label: '12 px' },
  { value: '3', label: '16 px' },
  { value: '4', label: '20 px' },
  { value: '5', label: '24 px' },
  { value: '6', label: '32 px' },
] as const;
const AFTERPARTY_TRIGGER_CLICK_COUNT = 5;
const AFTERPARTY_TRIGGER_WINDOW_MS = 2000;
type PersonalDrinkKey = string;
type PersonalDrinkCounts = Record<string, number>;
type PersonalDrinkStorageState = {
  selected: PersonalDrinkKey[];
  counts: PersonalDrinkCounts;
};
type AfterpartyParticipant = {
  id: string;
  display_name: string;
  troop_name: string;
};
type AfterpartyOrderStatus = 'pending' | 'approved' | 'rejected';
type AfterpartyOrderItemRow = {
  id: string;
  drink_key: string;
  label: string;
  category: string;
  quantity: number;
  approved_quantity: number;
  points_each: number;
  points_total: number;
};
type AfterpartyOrderRow = {
  id: string;
  participant_id: string;
  status: AfterpartyOrderStatus;
  receipt_path: string;
  total_points: number;
  review_note: string | null;
  submitted_at: string;
  reviewed_at: string | null;
  afterparty_order_items?: AfterpartyOrderItemRow[];
};
type AfterpartyAdminOrderRow = AfterpartyOrderRow & {
  receipt_signed_url?: string | null;
  afterparty_participants?: AfterpartyParticipant | null;
};
type AfterpartyIndividualLeaderboardRow = {
  participant_id: string;
  display_name: string;
  troop_name: string;
  total_points: number;
  approved_orders: number;
};
type AfterpartyTroopLeaderboardRow = {
  troop_name: string;
  total_points: number;
  participants: number;
  approved_orders: number;
};
type AfterpartyCounterMode = 'counter' | 'league';
type AfterpartyAdminSessionState = 'checking' | 'unauthorized' | 'authorized';
type AfterpartyDrinkCategory = (typeof AFTERPARTY_DRINK_MENU)[number]['category'];

type LeagueEvent = string;
type LeagueTroopEntry = {
  id: string;
  name: string;
  order?: number;
};
type LeagueScoresRecord = Record<string, Partial<Record<LeagueEvent, number | null>>>;
type LeagueScoreEntry = {
  season_id?: string | null;
  troop_id: string;
  event_key: string;
  points: number | string | null;
};
type LeagueSeason = {
  id: string;
  name: string;
  isActive: boolean;
  startsOn?: string | null;
  endsOn?: string | null;
  troops: LeagueTroopEntry[];
  events: LeagueEventEntry[];
  scores: LeagueScoresRecord;
};
type LeagueData = {
  seasons: LeagueSeason[];
  activeSeasonId: string;
};

const LEAGUE_TROOPS: LeagueTroopEntry[] = [
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
];
const DEFAULT_LEAGUE_SEASON_ID = '2025-2026';
const DEFAULT_LEAGUE_SEASON_NAME = 'Ročník 2025/2026';
const AFTERPARTY_TROOP_OPTIONS = LEAGUE_TROOPS.map((troop) => troop.name).sort((a, b) => {
  const aMatch = a.match(/^(\d+)\./);
  const bMatch = b.match(/^(\d+)\./);
  const aNumber = aMatch ? Number.parseInt(aMatch[1], 10) : null;
  const bNumber = bMatch ? Number.parseInt(bMatch[1], 10) : null;

  if (aNumber !== null && bNumber !== null) {
    if (aNumber !== bNumber) {
      return aNumber - bNumber;
    }
    return a.localeCompare(b, 'cs', { sensitivity: 'base' });
  }
  if (aNumber !== null) {
    return -1;
  }
  if (bNumber !== null) {
    return 1;
  }
  return a.localeCompare(b, 'cs', { sensitivity: 'base' });
});

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
  'https://docs.google.com/spreadsheets/d/e/2PACX-1vTgnHQSwUJSNQF_cfCEwRshBNhh67JWuV_EQO5urCaWgxlvAXLxAc8F8Nrt4PVsrw/pubhtml?gid=252350504&single=true&widget=false&headers=false';
const HISTORICAL_LEAGUE_VIEW_URL =
  'https://docs.google.com/spreadsheets/d/e/2PACX-1vTgnHQSwUJSNQF_cfCEwRshBNhh67JWuV_EQO5urCaWgxlvAXLxAc8F8Nrt4PVsrw/pubhtml?gid=252350504&single=true';

const HEADER_SUBTITLE = 'Soutěže, oddíly a informace na jednom místě.';
const HEADER_LEAD =
  'Aktuality z akcí SPTO, fotogalerie a přehled soutěží na jednom místě. Podívej se, co se právě děje v SPTO.';

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
  { name: 'René Hrabovský', troop: '64. PTO Lorien', term: '2022–2026' },
  { name: 'Ondřej Ševčík', troop: '32. PTO Severka', term: '2026–dosud' },
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
const HOMEPAGE_ARTICLE_LIMIT = 4;
const ARTICLES_PAGE_SIZE = 12;

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

type GalleryPhotoLike = {
  name: string;
  thumbnailLink?: string | null;
  fullImageUrl?: string | null;
  webContentLink?: string | null;
};

// TODO: Napojit na API / Supabase pro reálné pořadí Zelené ligy.

// Fotogalerie jde přes /api/gallery. API umí číst veřejné Cloudflare R2 manifesty
// a v přechodném režimu spadnout zpět na Google Drive.
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

const APPLICATION_LINKS = [
  {
    label: 'Setonův závod - aplikace',
    description: 'Hlavní rozhraní pro sběr bodů a správu stanovišť.',
    href: '/aplikace/setonuv-zavod',
  },
  {
    label: 'Deskové hry - aplikace',
    description: 'Rozhraní pro rozhodčí deskových her, zadávání zápasů a pořadí.',
    href: '/aplikace/deskovky',
  },
];

const CONTACTS = [
  {
    id: 'chief',
    role: 'Načelník SPTO',
    name: 'Ondřej Ševčík (Ševa)',
    phone: '+420 731 019 469',
    email: 'osevcik@severka.org',
  },
  {
    id: 'secretary-1',
    role: 'Sekretář SPTO',
    name: 'Jan Dalecký (Honza)',
    phone: '+420 730 997 353',
    email: 'honza@jmpionyr.cz',
  },
  {
    id: 'secretary-2',
    role: 'Sekretář SPTO',
    name: 'Martin Drahoš',
    phone: '+420 725 582 418',
    email: 'martin@severka.cz',
  },
  {
    id: 'webmaster',
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

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function normalizeEditorBodyHtml(value: string): string {
  const normalized = value
    .replace(/<p><br><\/p>/gi, '')
    .replace(/<div><br><\/div>/gi, '')
    .replace(/&nbsp;/gi, '')
    .replace(/\s+/g, '')
    .toLowerCase();
  if (!normalized || normalized === '<br>') {
    return '';
  }
  return value;
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

function isDriveImageUrl(url: string) {
  return url.includes('drive.google.com') || url.includes('googleusercontent.com');
}

function isDirectImageAssetUrl(url: string) {
  return /^\/api\/gallery\/image\b/.test(url) || /\.(?:avif|gif|jpe?g|png|webp)(?:[?#].*)?$/i.test(url);
}

function toProxyImageUrl(url: string, size: number, cropSquare = true) {
  const cleaned = url.replace(/^https?:\/\//i, '').replace(/^\/\//, '');
  const encoded = encodeURIComponent(cleaned);
  const cropParams = cropSquare ? `&h=${size}&fit=cover` : '';
  return `https://images.weserv.nl/?url=${encoded}&w=${size}${cropParams}&output=webp&q=80`;
}

function extractDriveFileId(url: string) {
  const match = url.match(/\/d\/([a-zA-Z0-9_-]+)/) || url.match(/id=([a-zA-Z0-9_-]+)/);
  return match?.[1] ?? null;
}

function getCachedArticleImageVariantUrl(url: string, size: number) {
  if (!url.includes('/articles/') || !/-w\d+\.webp(?:[?#].*)?$/i.test(url)) {
    return null;
  }
  const targetWidth = size <= 360 ? 360 : size <= 720 ? 720 : 1200;
  return url.replace(/-w\d+\.webp/i, `-w${targetWidth}.webp`);
}

function getArticleThumbUrl(url: string, size: number, cropSquare = true) {
  if (!url) {
    return '';
  }
  const cachedArticleVariant = getCachedArticleImageVariantUrl(url, size);
  if (cachedArticleVariant) {
    return cachedArticleVariant;
  }
  // pionyr.cz blocks server-side image proxies with HTTP 403, while direct browser requests work.
  if (url.startsWith('/') || url.includes('images.weserv.nl/') || url.includes('pionyr.cz/')) {
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
  return toProxyImageUrl(url, size, cropSquare);
}

function getPhotoThumbUrl(photo: GalleryPhotoLike | undefined | null, size: number) {
  if (!photo) {
    return '';
  }
  if (photo.thumbnailLink) {
    return isDriveImageUrl(photo.thumbnailLink) ? toDriveSizedUrl(photo.thumbnailLink, size) : photo.thumbnailLink;
  }
  const fallback = photo.fullImageUrl ?? photo.webContentLink;
  if (!fallback) {
    return '';
  }
  if (isDriveImageUrl(fallback)) {
    return toProxyImageUrl(fallback, size);
  }
  return isDirectImageAssetUrl(fallback) ? fallback : toProxyImageUrl(fallback, size);
}

function buildPhotoSrcSet(photo: GalleryPhotoLike | undefined | null, sizes: number[]) {
  const uniqueUrls = new Set<string>();
  const entries = sizes
    .map((size) => {
      const url = getPhotoThumbUrl(photo, size);
      if (!url || uniqueUrls.has(url)) {
        return null;
      }
      uniqueUrls.add(url);
      return url ? `${url} ${size}w` : null;
    })
    .filter((entry): entry is string => Boolean(entry));
  if (entries.length <= 1) {
    return '';
  }
  return entries.join(', ');
}

function buildArticleSrcSet(url: string, sizes: number[], cropSquare = true) {
  const uniqueUrls = new Set<string>();
  const entries = sizes
    .map((size) => {
      const sized = getArticleThumbUrl(url, size, cropSquare);
      if (!sized || uniqueUrls.has(sized)) {
        return null;
      }
      uniqueUrls.add(sized);
      return sized ? `${sized} ${size}w` : null;
    })
    .filter((entry): entry is string => Boolean(entry));
  return entries.length > 1 ? entries.join(', ') : '';
}

function fallbackToOriginalArticleImage(event: SyntheticEvent<HTMLImageElement>, originalUrl: string) {
  const image = event.currentTarget;
  if (!originalUrl || image.dataset.originalFallbackApplied === 'true') {
    return;
  }
  image.dataset.originalFallbackApplied = 'true';
  image.removeAttribute('srcset');
  image.src = originalUrl;
}

const portableTextComponents = {
  types: {
    image: ({ value }: { value: { asset?: { url?: string }; alt?: string } }) => {
      const src = value?.asset?.url;
      if (!src) {
        return null;
      }
      return <img src={src} alt={value.alt ?? ''} loading="lazy" decoding="async" />;
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

// Gallery cache helpers are imported from utils/galleryCache.ts
// fetchAlbumPreview() is used by GalleryAlbumCard components

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
  title,
  lead,
  links,
  backHref = '/',
  listClassName,
}: {
  title: string;
  lead: string;
  links?: InfoLink[];
  backHref?: string;
  listClassName?: string;
}) {
  return (
    <SiteShell>
      <main className="homepage-main homepage-single" aria-labelledby="info-heading">
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

function ArticleSkeletonGrid({ count = 4 }: { count?: number }) {
  return (
    <div className="homepage-article-grid homepage-skeleton-grid" aria-hidden="true">
      {Array.from({ length: count }).map((_, index) => (
        <article key={`article-skeleton-${index}`} className="homepage-article-card homepage-article-card--skeleton">
          <div className="homepage-article-row">
            <div className="homepage-article-thumb homepage-skeleton-block" />
            <div className="homepage-article-body">
              <div className="homepage-article-meta">
                <span className="homepage-skeleton-chip" />
              </div>
              <div className="homepage-skeleton-line homepage-skeleton-line--title" />
              <div className="homepage-skeleton-line homepage-skeleton-line--text" />
              <div className="homepage-skeleton-line homepage-skeleton-line--text short" />
              <div className="homepage-skeleton-line homepage-skeleton-line--link" />
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}

function GallerySkeletonGrid({ count = 8 }: { count?: number }) {
  const normalizedCount = Number.isFinite(count) ? Math.max(1, Math.round(count)) : 8;
  return (
    <section className="gallery-year-section gallery-year-section--skeleton">
      <div className="gallery-year-header" aria-hidden="true">
        <div className="homepage-skeleton-line homepage-skeleton-line--year" />
      </div>
      <div className="gallery-album-grid homepage-skeleton-grid" aria-hidden="true">
        {Array.from({ length: normalizedCount }).map((_, index) => (
          <div key={`gallery-skeleton-${index}`} className="gallery-album-card gallery-album-card--skeleton">
            <div className="gallery-album-cover homepage-skeleton-block" />
            <div className="gallery-album-body">
              <div className="homepage-skeleton-line homepage-skeleton-line--album-title" />
              <div className="homepage-skeleton-line homepage-skeleton-line--album-count" />
            </div>
            <div className="gallery-album-thumbs">
              <div className="homepage-skeleton-block gallery-skeleton-thumb" />
              <div className="homepage-skeleton-block gallery-skeleton-thumb" />
              <div className="homepage-skeleton-block gallery-skeleton-thumb" />
              <div className="homepage-skeleton-block gallery-skeleton-thumb" />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function ArticlesIndexPage({
  articles,
  articlesLoading,
  hasMore,
  loadingMore,
  onLoadMore,
}: {
  articles: Article[];
  articlesLoading: boolean;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
}) {
  return (
    <SiteShell>
      <main className="homepage-main homepage-single articles-page" aria-labelledby="articles-heading">
        <section className="homepage-section" aria-labelledby="articles-heading">
          <div className="homepage-section-header homepage-section-header--left">
            <h1 id="articles-heading">Články a novinky</h1>
            <span className="homepage-section-accent" aria-hidden="true" />
          </div>
          {articlesLoading ? (
            <>
              <p className="homepage-skeleton-status" role="status">
                Načítám články z redakce…
              </p>
              <ArticleSkeletonGrid count={ARTICLES_PAGE_SIZE} />
            </>
          ) : articles.length > 0 ? (
            <>
              <div className="homepage-article-grid homepage-article-grid--index">
                {articles.map((article, index) => {
                  const isPriorityImage = index === 0;
                  const coverUrl = article.coverImage?.url ? getArticleThumbUrl(article.coverImage.url, 360) : '';
                  const coverSrcSet = article.coverImage?.url
                    ? buildArticleSrcSet(article.coverImage.url, [180, 240, 360, 480])
                    : '';
                  const excerpt = article.excerpt.trim();
                  return (
                    <article key={article.href} className="homepage-article-card">
                      <div className="homepage-article-row">
                        <div className={`homepage-article-thumb${article.coverImage?.url ? '' : ' is-empty'}`}>
                          {article.coverImage?.url ? (
                            <img
                              src={coverUrl}
                              srcSet={coverSrcSet || undefined}
                              sizes="(max-width: 360px) 84px, (max-width: 680px) 96px, 150px"
                              width={150}
                              height={140}
                              alt={article.coverImage.alt ?? article.title}
                              loading={isPriorityImage ? 'eager' : 'lazy'}
                              decoding="async"
                              fetchPriority={isPriorityImage ? 'high' : 'low'}
                              onError={(event) =>
                                fallbackToOriginalArticleImage(event, article.coverImage?.url ?? '')
                              }
                            />
                          ) : (
                            <span aria-hidden="true">SPTO</span>
                          )}
                        </div>
                        <div className="homepage-article-body">
                          <div className="homepage-article-meta">
                            <time className="homepage-article-date" dateTime={article.dateISO}>
                              {article.dateLabel}
                            </time>
                          </div>
                          <h3 className="homepage-article-title">
                            {article.title}
                          </h3>
                          {excerpt ? (
                            <p className="homepage-article-excerpt">
                              {excerpt}
                            </p>
                          ) : null}
                          <a className="homepage-inline-link homepage-article-read-link" href={article.href}>
                            Číst článek <span aria-hidden="true">→</span>
                          </a>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
              {hasMore ? (
                <button
                  type="button"
                  className="homepage-cta secondary articles-load-more"
                  onClick={onLoadMore}
                  disabled={loadingMore}
                >
                  {loadingMore ? 'Načítám další články…' : 'Načíst další články'}
                </button>
              ) : null}
            </>
          ) : (
            <div className="homepage-card">
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
        <h1 id="troops-heading">Oddíly SPTO</h1>
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
        <a className="homepage-back-link homepage-back-link--inline" href="/oddily">
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
        <h1 id="contacts-heading">Kontakty</h1>
        <div className="homepage-card">
          <div className="contacts-grid">
            {CONTACTS.map((contact) => (
              <div key={contact.id} className="contact-card">
                <div className="contact-card-header">
                  <strong>{contact.role}</strong>
                  <span>{contact.name || 'Informace budou doplněny'}</span>
                </div>
                {contact.phone || contact.email ? (
                  <div className="contact-card-meta">
                    {contact.phone ? (
                      <span>
                        Telefon:{' '}
                        <a href={toTelHref(contact.phone)} className="contact-card-link">
                          {contact.phone}
                        </a>
                      </span>
                    ) : null}
                    {contact.email ? (
                      <span>
                        E-mail:{' '}
                        <a href={`mailto:${contact.email}`} className="contact-card-link">
                          {contact.email}
                        </a>
                      </span>
                    ) : null}
                  </div>
                ) : null}
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
              {mediaItems.map((photo, index) => {
                const isCover = index === 0 && Boolean(coverImage);
                const isPriorityImage = index === 0;
                const imageSize = isCover ? 960 : 720;
                const src = getArticleThumbUrl(photo.src, imageSize, false) || photo.src;
                const srcSet = buildArticleSrcSet(
                  photo.src,
                  isCover ? [480, 720, 960, 1200] : [320, 480, 720, 960],
                  false,
                );
                return (
                  <img
                    key={`${article.href}-photo-${index}`}
                    className={isCover ? 'homepage-article-cover' : undefined}
                    src={src}
                    srcSet={srcSet || undefined}
                    sizes="(max-width: 900px) 100vw, 38vw"
                    alt={photo.alt}
                    loading={isPriorityImage ? 'eager' : 'lazy'}
                    decoding="async"
                    fetchPriority={isPriorityImage ? 'high' : 'low'}
                    onError={(event) => fallbackToOriginalArticleImage(event, photo.src)}
                  />
                );
              })}
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

type EditorSignedImageUpload = {
  fileName: string;
  contentType: string;
  path: string;
  token: string;
  publicUrl: string;
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
  const [leagueData, setLeagueData] = useState<LeagueData>(createDefaultLeagueData());
  const [selectedLeagueSeasonId, setSelectedLeagueSeasonId] = useState(DEFAULT_LEAGUE_SEASON_ID);
  const [newLeagueSeasonName, setNewLeagueSeasonName] = useState('');
  const [newLeagueTroopName, setNewLeagueTroopName] = useState('');
  const [newLeagueEventLabel, setNewLeagueEventLabel] = useState('');
  const [newLeagueEventName, setNewLeagueEventName] = useState('');
  const [leagueMessage, setLeagueMessage] = useState<string | null>(null);
  const [leagueSaving, setLeagueSaving] = useState(false);
  const [albumTitleAlbums, setAlbumTitleAlbums] = useState<DriveAlbum[]>([]);
  const [albumTitleEdits, setAlbumTitleEdits] = useState<Record<string, string>>({});
  const [albumTitleOriginals, setAlbumTitleOriginals] = useState<Record<string, string>>({});
  const [albumTitleMessage, setAlbumTitleMessage] = useState<string | null>(null);
  const [albumTitleLoading, setAlbumTitleLoading] = useState(false);
  const [albumTitleSaving, setAlbumTitleSaving] = useState(false);
  const [articleUploadMessage, setArticleUploadMessage] = useState<string | null>(null);
  const [articleUploadSaving, setArticleUploadSaving] = useState(false);
  const bodyEditorRef = useRef<HTMLDivElement | null>(null);

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
        const normalized = normalizeLeagueData(data);
        setLeagueData(normalized);
        setSelectedLeagueSeasonId((current) =>
          normalized.seasons.some((season) => season.id === current) ? current : normalized.activeSeasonId,
        );
      })
      .catch(() => {
        const fallback = createDefaultLeagueData();
        setLeagueData(fallback);
        setSelectedLeagueSeasonId(fallback.activeSeasonId);
      });

  const loadAlbumTitles = () => {
    setAlbumTitleLoading(true);
    setAlbumTitleMessage(null);
    return Promise.all([
      fetch('/api/gallery?nocache=1')
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

  const syncBodyFromEditor = useCallback(() => {
    const html = bodyEditorRef.current?.innerHTML ?? '';
    const normalizedHtml = normalizeEditorBodyHtml(html);
    setForm((prev) => (prev.body === normalizedHtml ? prev : { ...prev, body: normalizedHtml }));
  }, []);

  const applyBodyToEditor = useCallback((value: string) => {
    const editor = bodyEditorRef.current;
    if (!editor) {
      return;
    }
    const next = value || '';
    if (/<[a-z][\s\S]*>/i.test(next)) {
      if (editor.innerHTML !== next) {
        editor.innerHTML = next;
      }
      return;
    }
    if (editor.textContent !== next) {
      editor.textContent = next;
    }
  }, []);

  const runBodyCommand = useCallback(
    (command: string, value?: string) => {
      const editor = bodyEditorRef.current;
      if (!editor) {
        return;
      }
      editor.focus();
      try {
        document.execCommand('styleWithCSS', false, 'true');
      } catch {
        // Some browsers can reject styleWithCSS; commands still work without it.
      }
      document.execCommand(command, false, value);
      syncBodyFromEditor();
    },
    [syncBodyFromEditor],
  );

  const handleBodyInput = () => {
    syncBodyFromEditor();
  };

  const handleInsertLink = () => {
    const editor = bodyEditorRef.current;
    if (!editor) {
      return;
    }
    const selectionText = window.getSelection()?.toString().trim() ?? '';
    if (!selectionText) {
      setArticleUploadMessage('Nejdřív označ text, na který chceš vložit odkaz.');
      return;
    }
    const rawUrl = window.prompt('Zadej URL odkazu (https://...)');
    if (!rawUrl) {
      return;
    }
    const normalizedUrl = rawUrl.trim();
    if (!/^https?:\/\//i.test(normalizedUrl)) {
      setArticleUploadMessage('Odkaz musí začínat na http:// nebo https://');
      return;
    }
    setArticleUploadMessage(null);
    runBodyCommand('createLink', normalizedUrl);
  };

  const handleBodyFontSizeChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const value = event.target.value.trim();
    if (!value) {
      return;
    }
    runBodyCommand('fontSize', value);
    event.target.value = '';
  };

  const handleArticleImageUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    if (!files.length) {
      return;
    }
    setArticleUploadMessage(null);
    const invalid = files.find(
      (file) => !CONTENT_ARTICLE_ALLOWED_IMAGE_TYPES.includes(file.type as (typeof CONTENT_ARTICLE_ALLOWED_IMAGE_TYPES)[number]),
    );
    if (invalid) {
      setArticleUploadMessage(`Soubor ${invalid.name} není podporovaný obrázek.`);
      event.target.value = '';
      return;
    }

    setArticleUploadSaving(true);
    try {
      const response = await fetch('/api/content/admin/article-images', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          files: files.map((file) => ({
            name: file.name,
            type: file.type,
            size: file.size,
          })),
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        uploads?: EditorSignedImageUpload[];
      };
      if (!response.ok) {
        throw new Error(payload.error || 'Nepodařilo se připravit upload obrázků.');
      }

      const uploads = Array.isArray(payload.uploads) ? payload.uploads : [];
      if (uploads.length !== files.length) {
        throw new Error('Server vrátil nekompletní seznam uploadů.');
      }

      const insertedBlocks: string[] = [];
      for (let index = 0; index < files.length; index += 1) {
        const file = files[index];
        const uploadMeta = uploads[index];
        const { error: uploadError } = await supabase.storage
          .from(CONTENT_ARTICLE_IMAGES_BUCKET)
          .uploadToSignedUrl(uploadMeta.path, uploadMeta.token, file, {
            contentType: file.type || uploadMeta.contentType || undefined,
            upsert: false,
          });
        if (uploadError) {
          throw uploadError;
        }
        const alt = escapeHtml(file.name.replace(/\.[^.]+$/, '').trim());
        insertedBlocks.push(`<figure><img src="${uploadMeta.publicUrl}" alt="${alt}" loading="lazy"></figure>`);
      }

      if (insertedBlocks.length > 0) {
        const htmlToInsert = insertedBlocks.join('<p><br></p>');
        if (bodyEditorRef.current) {
          bodyEditorRef.current.focus();
          document.execCommand('insertHTML', false, htmlToInsert);
          syncBodyFromEditor();
        } else {
          setForm((prev) => {
            const merged = [prev.body, htmlToInsert].filter(Boolean).join('\n');
            return { ...prev, body: normalizeEditorBodyHtml(merged) };
          });
        }

        if (!form.cover_image_url && uploads[0]?.publicUrl) {
          setForm((prev) => ({
            ...prev,
            cover_image_url: prev.cover_image_url || uploads[0].publicUrl,
            cover_image_alt: prev.cover_image_alt || files[0].name.replace(/\.[^.]+$/, '').trim(),
          }));
        }
      }

      setArticleUploadMessage(`Nahráno ${files.length} souborů.`);
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Nepodařilo se nahrát obrázky.';
      setArticleUploadMessage(detail);
    } finally {
      setArticleUploadSaving(false);
      event.target.value = '';
    }
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

  useEffect(() => {
    applyBodyToEditor(form.body);
  }, [applyBodyToEditor, form.body]);

  const handleLogin = (event: FormEvent) => {
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
      const fallback = createDefaultLeagueData();
      setLeagueData(fallback);
      setSelectedLeagueSeasonId(fallback.activeSeasonId);
      setNewLeagueSeasonName('');
      setNewLeagueTroopName('');
      setNewLeagueEventLabel('');
      setNewLeagueEventName('');
      setLeagueMessage(null);
      setAlbumTitleAlbums([]);
      setAlbumTitleEdits({});
      setAlbumTitleOriginals({});
      setAlbumTitleMessage(null);
      setArticleUploadMessage(null);
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
    setArticleUploadMessage(null);
  };

  const handleNew = () => {
    setActiveId(null);
    setForm(EMPTY_EDITOR_FORM);
    setMessage(null);
    setArticleUploadMessage(null);
  };

  const handleSave = () => {
    setMessage(null);
    const currentEditorBody = normalizeEditorBodyHtml(bodyEditorRef.current?.innerHTML ?? form.body);
    if (currentEditorBody !== form.body) {
      setForm((prev) => ({ ...prev, body: currentEditorBody }));
    }
    const payload = {
      title: form.title.trim(),
      slug: form.slug.trim() || slugify(form.title),
      excerpt: form.excerpt,
      body: currentEditorBody,
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

  const updateLeagueSeason = (seasonId: string, updater: (season: LeagueSeason) => LeagueSeason) => {
    setLeagueData((current) => ({
      ...current,
      seasons: current.seasons.map((season) => (season.id === seasonId ? updater(season) : season)),
    }));
  };

  const updateLeagueScore = (troopId: string, eventKey: LeagueEvent, rawValue: string) => {
    const normalized = rawValue.replace(',', '.').trim();
    const parsed = normalized.length > 0 ? Number(normalized) : null;
    const nextValue = parsed !== null && Number.isFinite(parsed) ? parsed : null;
    updateLeagueSeason(selectedLeagueSeasonId, (season) => ({
      ...season,
      scores: {
        ...season.scores,
        [troopId]: {
          ...(season.scores[troopId] ?? {}),
          [eventKey]: nextValue,
        },
      },
    }));
    setLeagueMessage(null);
  };

  const updateLeagueSeasonName = (value: string) => {
    updateLeagueSeason(selectedLeagueSeasonId, (season) => ({ ...season, name: value }));
    setLeagueMessage(null);
  };

  const updateLeagueSeasonActive = (isActive: boolean) => {
    setLeagueData((current) => ({
      activeSeasonId: isActive
        ? selectedLeagueSeasonId
        : current.activeSeasonId === selectedLeagueSeasonId
          ? current.seasons.find((season) => season.id !== selectedLeagueSeasonId && season.isActive)?.id ??
          current.seasons.find((season) => season.id !== selectedLeagueSeasonId)?.id ??
          selectedLeagueSeasonId
          : current.activeSeasonId,
      seasons: current.seasons.map((season) => ({
        ...season,
        isActive: season.id === selectedLeagueSeasonId ? isActive : isActive ? false : season.isActive,
      })),
    }));
    setLeagueMessage(null);
  };

  const handleCreateLeagueSeason = () => {
    const name = newLeagueSeasonName.trim();
    if (!name) {
      setLeagueMessage('Zadej název ročníku.');
      return;
    }
    const baseId = slugify(name) || `rocnik-${Date.now()}`;
    setLeagueData((current) => {
      let id = baseId;
      let suffix = 2;
      while (current.seasons.some((season) => season.id === id)) {
        id = `${baseId}-${suffix}`;
        suffix += 1;
      }
      const sourceSeason =
        current.seasons.find((season) => season.id === selectedLeagueSeasonId) ??
        getActiveLeagueSeason(current);
      const nextSeason: LeagueSeason = {
        id,
        name,
        isActive: false,
        troops: cloneLeagueTroops(sourceSeason.troops.length > 0 ? sourceSeason.troops : LEAGUE_TROOPS),
        events: cloneLeagueEvents(sourceSeason.events.length > 0 ? sourceSeason.events : LEAGUE_EVENTS),
        scores: {},
      };
      setSelectedLeagueSeasonId(id);
      return {
        ...current,
        seasons: [nextSeason, ...current.seasons],
      };
    });
    setNewLeagueSeasonName('');
    setLeagueMessage('Ročník je připravený. Nezapomeň ho uložit.');
  };

  const handleAddLeagueTroop = () => {
    const name = newLeagueTroopName.trim();
    if (!name) {
      setLeagueMessage('Zadej název oddílu.');
      return;
    }
    const baseId = slugify(name) || `oddil-${Date.now()}`;
    updateLeagueSeason(selectedLeagueSeasonId, (season) => {
      let id = baseId;
      let suffix = 2;
      while (season.troops.some((troop) => troop.id === id)) {
        id = `${baseId}-${suffix}`;
        suffix += 1;
      }
      return {
        ...season,
        troops: [...season.troops, { id, name, order: season.troops.length }],
      };
    });
    setNewLeagueTroopName('');
    setLeagueMessage(null);
  };

  const handleRemoveLeagueTroop = (troopId: string) => {
    updateLeagueSeason(selectedLeagueSeasonId, (season) => {
      const nextScores = { ...season.scores };
      delete nextScores[troopId];
      return {
        ...season,
        troops: season.troops
          .filter((troop) => troop.id !== troopId)
          .map((troop, index) => ({ ...troop, order: index })),
        scores: nextScores,
      };
    });
    setLeagueMessage(null);
  };

  const updateLeagueEvent = (eventKey: string, patch: Partial<Pick<LeagueEventEntry, 'label' | 'name'>>) => {
    updateLeagueSeason(selectedLeagueSeasonId, (season) => ({
      ...season,
      events: season.events.map((event) => (event.key === eventKey ? { ...event, ...patch } : event)),
    }));
    setLeagueMessage(null);
  };

  const handleAddLeagueEvent = () => {
    const name = newLeagueEventName.trim();
    const label = newLeagueEventLabel.trim() || name;
    if (!name && !label) {
      setLeagueMessage('Zadej název soutěže.');
      return;
    }
    const baseKey = slugify(name || label) || `soutez-${Date.now()}`;
    updateLeagueSeason(selectedLeagueSeasonId, (season) => {
      let key = baseKey;
      let suffix = 2;
      while (season.events.some((event) => event.key === key)) {
        key = `${baseKey}-${suffix}`;
        suffix += 1;
      }
      return {
        ...season,
        events: [...season.events, { key, label, name: name || label, order: season.events.length }],
      };
    });
    setNewLeagueEventLabel('');
    setNewLeagueEventName('');
    setLeagueMessage(null);
  };

  const handleRemoveLeagueEvent = (eventKey: string) => {
    updateLeagueSeason(selectedLeagueSeasonId, (season) => ({
      ...season,
      events: season.events
        .filter((event) => event.key !== eventKey)
        .map((event, index) => ({ ...event, order: index })),
      scores: Object.fromEntries(
        Object.entries(season.scores).map(([troopId, troopScores]) => {
          const nextScores = { ...(troopScores ?? {}) };
          delete nextScores[eventKey];
          return [troopId, nextScores];
        }),
      ),
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
    const selectedSeason =
      leagueData.seasons.find((season) => season.id === selectedLeagueSeasonId) ??
      getActiveLeagueSeason(leagueData);
    const seasonName = selectedSeason.name.trim();
    if (!seasonName) {
      setLeagueSaving(false);
      setLeagueMessage('Název ročníku nesmí být prázdný.');
      return;
    }
    if (selectedSeason.troops.length === 0) {
      setLeagueSaving(false);
      setLeagueMessage('Ročník musí mít aspoň jeden oddíl.');
      return;
    }
    if (selectedSeason.events.length === 0) {
      setLeagueSaving(false);
      setLeagueMessage('Ročník musí mít aspoň jednu soutěž.');
      return;
    }
    const payloadScores = selectedSeason.troops.flatMap((troop) =>
      selectedSeason.events.map((event) => ({
        season_id: selectedSeason.id,
        troop_id: troop.id,
        event_key: event.key,
        points: selectedSeason.scores[troop.id]?.[event.key] ?? null,
      })),
    );
    fetch('/api/content/admin/league', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        season: {
          id: selectedSeason.id,
          name: seasonName,
          is_active: selectedSeason.isActive,
          starts_on: selectedSeason.startsOn ?? null,
          ends_on: selectedSeason.endsOn ?? null,
        },
        troops: selectedSeason.troops.map((troop, index) => ({
          troop_id: troop.id,
          troop_name: troop.name,
          order_index: troop.order ?? index,
        })),
        events: selectedSeason.events.map((event, index) => ({
          event_key: event.key,
          event_label: event.label.trim() || event.name.trim() || event.key,
          event_name: event.name.trim() || event.label.trim() || event.key,
          order_index: event.order ?? index,
        })),
        scores: payloadScores,
      }),
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

  const selectedLeagueSeason =
    leagueData.seasons.find((season) => season.id === selectedLeagueSeasonId) ??
    getActiveLeagueSeason(leagueData);
  const leagueGridTemplate = `minmax(220px, 1.4fr) repeat(${selectedLeagueSeason.events.length}, minmax(90px, 0.8fr)) minmax(90px, 0.8fr)`;
  const leagueRows = addCompetitionRanks(
    buildLeagueRows(selectedLeagueSeason.scores, selectedLeagueSeason.troops, selectedLeagueSeason.events),
  );
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
                  <div className="editor-rich-toolbar" role="group" aria-label="Nástroje textu">
                    <button type="button" onClick={() => runBodyCommand('bold')} title="Tučné písmo">
                      <strong>B</strong>
                    </button>
                    <button type="button" onClick={() => runBodyCommand('italic')} title="Kurzíva">
                      <em>I</em>
                    </button>
                    <button type="button" onClick={() => runBodyCommand('underline')} title="Podtržené písmo">
                      <span style={{ textDecoration: 'underline' }}>U</span>
                    </button>
                    <button type="button" onClick={handleInsertLink} title="Vložit odkaz">
                      Odkaz
                    </button>
                    <select defaultValue="" onChange={handleBodyFontSizeChange} title="Velikost písma">
                      <option value="" disabled>
                        Velikost písma
                      </option>
                      {CONTENT_ARTICLE_FONT_SIZE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div
                    ref={bodyEditorRef}
                    className="editor-rich-input"
                    contentEditable
                    suppressContentEditableWarning
                    role="textbox"
                    aria-label="Text článku"
                    aria-multiline="true"
                    data-placeholder="Napiš text článku…"
                    onInput={handleBodyInput}
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
                <label className="editor-upload-field">
                  Fotky článku (můžeš vybrat více souborů)
                  <input
                    type="file"
                    multiple
                    accept={CONTENT_ARTICLE_ALLOWED_IMAGE_TYPES.join(',')}
                    onChange={handleArticleImageUpload}
                    disabled={articleUploadSaving}
                  />
                </label>
                {articleUploadMessage ? <p className="homepage-alert">{articleUploadMessage}</p> : null}
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
                  <h2>Pořadí Zelené ligy podle ročníků</h2>
                  <p>Vytvářej ročníky, nastav účastnící se oddíly a uprav body v jednotlivých soutěžích.</p>
                </div>
                <div className="editor-league-actions">
                  <button type="button" className="homepage-button" onClick={handleLeagueSave} disabled={leagueSaving}>
                    {leagueSaving ? 'Ukládám…' : 'Uložit ročník'}
                  </button>
                </div>
              </div>
              {leagueMessage ? <p className="homepage-alert">{leagueMessage}</p> : null}
              <div className="gallery-year-tabs editor-league-season-tabs" aria-label="Ročníky pořadí">
                {leagueData.seasons.map((season) => (
                  <button
                    key={season.id}
                    type="button"
                    className={`gallery-year-tab${season.id === selectedLeagueSeason.id ? ' is-active' : ''}`}
                    onClick={() => {
                      setSelectedLeagueSeasonId(season.id);
                      setLeagueMessage(null);
                    }}
                  >
                    {season.name}
                    {season.isActive ? ' · aktuální' : ''}
                  </button>
                ))}
              </div>
              <div className="editor-league-season-panel">
                <label className="editor-field" htmlFor="editor-league-season-name">
                  <span>Název ročníku</span>
                  <input
                    id="editor-league-season-name"
                    type="text"
                    value={selectedLeagueSeason.name}
                    onChange={(event) => updateLeagueSeasonName(event.target.value)}
                  />
                </label>
                <label className="editor-check" htmlFor="editor-league-season-active">
                  <input
                    id="editor-league-season-active"
                    type="checkbox"
                    checked={selectedLeagueSeason.isActive}
                    onChange={(event) => updateLeagueSeasonActive(event.target.checked)}
                  />
                  <span>Tento ročník zobrazovat jako aktuální</span>
                </label>
              </div>
              <div className="editor-league-season-create">
                <label className="editor-field" htmlFor="editor-league-new-season">
                  <span>Vytvořit nový ročník</span>
                  <input
                    id="editor-league-new-season"
                    type="text"
                    value={newLeagueSeasonName}
                    onChange={(event) => setNewLeagueSeasonName(event.target.value)}
                    placeholder="Např. Ročník 2026/2027"
                  />
                </label>
                <button type="button" className="homepage-button homepage-button--ghost" onClick={handleCreateLeagueSeason}>
                  Vytvořit ročník
                </button>
              </div>
              <div className="editor-league-troops">
                <div>
                  <h3>Oddíly v ročníku</h3>
                  <p>Oddíl odstraněný z ročníku se nebude počítat do tabulky, ostatní ročníky zůstanou beze změny.</p>
                </div>
                <div className="editor-league-troop-list">
                  {selectedLeagueSeason.troops.map((troop) => (
                    <span key={troop.id} className="editor-league-troop-pill">
                      {troop.name}
                      <button
                        type="button"
                        onClick={() => handleRemoveLeagueTroop(troop.id)}
                        aria-label={`Odebrat oddíl ${troop.name}`}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
                <div className="editor-league-season-create">
                  <label className="editor-field" htmlFor="editor-league-new-troop">
                    <span>Přidat oddíl</span>
                    <input
                      id="editor-league-new-troop"
                      type="text"
                      value={newLeagueTroopName}
                      onChange={(event) => setNewLeagueTroopName(event.target.value)}
                      placeholder="Např. 32. PTO Severka"
                    />
                  </label>
                  <button type="button" className="homepage-button homepage-button--ghost" onClick={handleAddLeagueTroop}>
                    Přidat oddíl
                  </button>
                </div>
              </div>
              <div className="editor-league-troops editor-league-events">
                <div>
                  <h3>Soutěže v ročníku</h3>
                  <p>Soutěže můžeš pro každý ročník pojmenovat jinak nebo je úplně odebrat.</p>
                </div>
                <div className="editor-league-event-list">
                  {selectedLeagueSeason.events.map((event) => (
                    <div key={event.key} className="editor-league-event-row">
                      <label className="editor-field" htmlFor={`editor-league-event-label-${event.key}`}>
                        <span>Zkratka v tabulce</span>
                        <input
                          id={`editor-league-event-label-${event.key}`}
                          type="text"
                          value={event.label}
                          onChange={(changeEvent) => updateLeagueEvent(event.key, { label: changeEvent.target.value })}
                          placeholder="PTOB"
                        />
                      </label>
                      <label className="editor-field" htmlFor={`editor-league-event-name-${event.key}`}>
                        <span>Název soutěže</span>
                        <input
                          id={`editor-league-event-name-${event.key}`}
                          type="text"
                          value={event.name}
                          onChange={(changeEvent) => updateLeagueEvent(event.key, { name: changeEvent.target.value })}
                          placeholder="Orientační běh"
                        />
                      </label>
                      <button
                        type="button"
                        className="homepage-button homepage-button--ghost editor-league-event-remove"
                        onClick={() => handleRemoveLeagueEvent(event.key)}
                      >
                        Odebrat
                      </button>
                    </div>
                  ))}
                </div>
                <div className="editor-league-season-create editor-league-event-create">
                  <label className="editor-field" htmlFor="editor-league-new-event-label">
                    <span>Zkratka</span>
                    <input
                      id="editor-league-new-event-label"
                      type="text"
                      value={newLeagueEventLabel}
                      onChange={(event) => setNewLeagueEventLabel(event.target.value)}
                      placeholder="Např. ZL"
                    />
                  </label>
                  <label className="editor-field" htmlFor="editor-league-new-event-name">
                    <span>Název nové soutěže</span>
                    <input
                      id="editor-league-new-event-name"
                      type="text"
                      value={newLeagueEventName}
                      onChange={(event) => setNewLeagueEventName(event.target.value)}
                      placeholder="Např. Závod ligy"
                    />
                  </label>
                  <button type="button" className="homepage-button homepage-button--ghost" onClick={handleAddLeagueEvent}>
                    Přidat soutěž
                  </button>
                </div>
              </div>
              <div className="editor-league-table" style={{ '--league-editor-grid': leagueGridTemplate } as React.CSSProperties}>
                <div className="editor-league-row editor-league-row--header">
                  <span>Oddíl</span>
                  {selectedLeagueSeason.events.map((event) => (
                    <span key={event.key} className="editor-league-score">
                      {event.label}
                    </span>
                  ))}
                  <span className="editor-league-score">Celkem</span>
                </div>
                {leagueRows.map((row) => (
                  <div key={row.key} className="editor-league-row">
                    <span className="editor-league-name">{row.name}</span>
                    {selectedLeagueSeason.events.map((event) => {
                      const value = selectedLeagueSeason.scores[row.key]?.[event.key];
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
  const [preview, setPreview] = useState<CachedGalleryPreview | null>(null);
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
  const coverUrl = getPhotoThumbUrl(coverPhoto ?? undefined, 720) || null;
  const coverSrcSet = coverPhoto ? buildPhotoSrcSet(coverPhoto, [360, 540, 720, 960]) : '';
  const previewPhotos = preview?.files ?? [];

  return (
    <a className="gallery-album-card" href={`/fotogalerie/${album.slug}`}>
      <div className="gallery-album-cover">
        {coverUrl ? (
          <img
            src={coverUrl}
            srcSet={coverSrcSet || undefined}
            sizes="(max-width: 700px) 90vw, (max-width: 1100px) 45vw, 320px"
            width={960}
            height={540}
            alt={album.title}
            loading="lazy"
            decoding="async"
          />
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
            const thumbUrl = getPhotoThumbUrl(photo, 240);
            const thumbSrcSet = buildPhotoSrcSet(photo, [120, 180, 240, 360]);
            return thumbUrl ? (
              <img
                key={photo.fileId}
                src={thumbUrl}
                srcSet={thumbSrcSet || undefined}
                sizes="(max-width: 700px) 20vw, 72px"
                width={120}
                height={120}
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

function GalleryOverviewPage({
  albums,
  loading,
  years,
  selectedYear,
  loadingSkeletonCount,
  onSelectYear,
}: {
  albums: DriveAlbum[];
  loading: boolean;
  years: string[];
  selectedYear: string | null;
  loadingSkeletonCount?: number;
  onSelectYear: (year: string) => void;
}) {
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
        <h1 id="gallery-heading">Fotogalerie</h1>
        {years.length > 0 ? (
          <div className="gallery-year-tabs" role="tablist" aria-label="Výběr roku fotogalerie">
            {years.map((year) => {
              const isActive = selectedYear === year;
              return (
                <button
                  key={year}
                  type="button"
                  className={`gallery-year-tab${isActive ? ' is-active' : ''}`}
                  onClick={() => onSelectYear(year)}
                  aria-pressed={isActive}
                >
                  {year}
                </button>
              );
            })}
          </div>
        ) : null}
        {loading ? (
          <>
            <p className="homepage-skeleton-status" role="status">
              Načítám alba…
            </p>
            <GallerySkeletonGrid count={loadingSkeletonCount} />
          </>
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
  const loadingPageRef = useRef(false);

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
    loadingPageRef.current = false;
    setPhotos([]);
    setNextPageToken(null);
    setLightboxIndex(null);
    setIsLoading(true);
    const params = new URLSearchParams({
      folderId: album.folderId,
      pageSize: String(GALLERY_PAGE_SIZE),
      includeSubfolders: '1',
    });
    fetch(`/api/gallery?${params.toString()}`)
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
          setNextPageToken(null);
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

  const handleLoadMore = useCallback(async () => {
    if (!album?.folderId || !nextPageToken || loadingPageRef.current) {
      return false;
    }
    loadingPageRef.current = true;
    setIsLoading(true);
    const params = new URLSearchParams({
      folderId: album.folderId,
      pageSize: String(GALLERY_PAGE_SIZE),
      pageToken: nextPageToken,
      includeSubfolders: '1',
    });
    try {
      const response = await fetch(`/api/gallery?${params.toString()}`);
      if (!response.ok) {
        throw new Error('Failed to load more photos.');
      }
      const data = await response.json();
      const nextFiles = Array.isArray(data.files) ? (data.files as GalleryPhoto[]) : [];
      setPhotos((prev) => [...prev, ...nextFiles]);
      setNextPageToken(data.nextPageToken ?? null);
      return nextFiles.length > 0;
    } catch (error) {
      console.error('Failed to load more gallery photos', error);
      return false;
    } finally {
      loadingPageRef.current = false;
      setIsLoading(false);
    }
  }, [album?.folderId, nextPageToken]);

  const activePhoto = lightboxIndex !== null ? photos[lightboxIndex] : null;
  const isFirstPhoto = lightboxIndex === 0;
  const isAtLoadedEnd = lightboxIndex !== null && lightboxIndex >= photos.length - 1;
  const canGoNext = lightboxIndex !== null && (lightboxIndex < photos.length - 1 || Boolean(nextPageToken));
  const getLightboxUrl = (photo?: GalleryPhoto | null) => {
    if (!photo) {
      return '';
    }
    if (photo.fullImageUrl) {
      return photo.fullImageUrl;
    }
    if (photo.thumbnailLink) {
      return isDriveImageUrl(photo.thumbnailLink) ? toDriveSizedUrl(photo.thumbnailLink, 1800) : photo.thumbnailLink;
    }
    return photo.webContentLink ?? '';
  };
  const activePhotoUrl = getLightboxUrl(activePhoto);

  const handlePreviousPhoto = useCallback(() => {
    setLightboxIndex((prev) => (prev !== null && prev > 0 ? prev - 1 : prev));
  }, []);

  const handleNextPhoto = useCallback(async () => {
    if (lightboxIndex === null) {
      return;
    }
    if (lightboxIndex < photos.length - 1) {
      setLightboxIndex(lightboxIndex + 1);
      return;
    }
    if (!nextPageToken) {
      return;
    }
    const loaded = await handleLoadMore();
    if (loaded) {
      setLightboxIndex((prev) => (prev !== null ? prev + 1 : prev));
    }
  }, [handleLoadMore, lightboxIndex, nextPageToken, photos.length]);

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
    if (lightboxIndex === null || !nextPageToken || isLoading) {
      return;
    }
    if (photos.length - lightboxIndex <= 4) {
      void handleLoadMore();
    }
  }, [handleLoadMore, isLoading, lightboxIndex, nextPageToken, photos.length]);

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
        handlePreviousPhoto();
        return;
      }
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        void handleNextPhoto();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [handleNextPhoto, handlePreviousPhoto, lightboxIndex]);

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
        <h1 id="album-heading">{album.title}</h1>
        <p className="homepage-lead">
          {album.year}
        </p>
        <div className="gallery-photo-grid">
          {photos.map((photo, index) => {
            const thumbUrl = getPhotoThumbUrl(photo, 480);
            const thumbSrcSet = buildPhotoSrcSet(photo, [240, 360, 480, 640]);
            return (
              <button
                key={photo.fileId}
                type="button"
                className="gallery-photo-thumb"
                onClick={() => setLightboxIndex(index)}
              >
                {thumbUrl ? (
                  <img
                    src={thumbUrl}
                    srcSet={thumbSrcSet || undefined}
                    alt={photo.name}
                    loading={index < 6 ? 'eager' : 'lazy'}
                    decoding="async"
                    sizes="(max-width: 600px) 45vw, (max-width: 900px) 30vw, 220px"
                    width={480}
                    height={360}
                    fetchPriority={index < 4 ? 'high' : 'auto'}
                  />
                ) : (
                  <span>{photo.name}</span>
                )}
              </button>
            );
          })}
        </div>
        {!isLoading && photos.length === 0 ? <div className="gallery-loading">Zatím zde nejsou žádné fotky.</div> : null}
        {isLoading ? <div className="gallery-loading">Načítám fotky…</div> : null}
        {nextPageToken ? (
          <button type="button" className="homepage-cta secondary gallery-load-more" onClick={handleLoadMore} disabled={isLoading}>
            Načíst další fotky
          </button>
        ) : null}
        <a className="homepage-back-link homepage-back-link--inline" href="/fotogalerie">
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
            onClick={handlePreviousPhoto}
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
            onClick={() => void handleNextPhoto()}
            aria-label="Další fotka"
            disabled={!canGoNext || (isAtLoadedEnd && isLoading)}
          >
            ›
          </button>
        </div>
      ) : null}
    </SiteShell>
  );
}

function ArticlePageLoader({ slug }: { slug: string }) {
  const [article, setArticle] = useState<Article | null>(null);

  useEffect(() => {
    let active = true;
    setArticle(null);
    fetchContentArticle(slug)
      .then((data) => {
        if (!active || !data) {
          return;
        }
        setArticle(mapContentArticle(data));
      })
      .catch(() => {
        // The loading state stays visible and a reload retries the request.
      });
    return () => {
      active = false;
    };
  }, [slug]);

  if (!article) {
    return (
      <InfoPage
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

function getLeagueTroopNameNumber(name: string): number | null {
  const match = name.match(/\d+/);
  if (!match) {
    return null;
  }
  const parsed = Number.parseInt(match[0], 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function compareLeagueRowsByTroopNumber(a: Pick<LeagueRow, 'name' | 'order'>, b: Pick<LeagueRow, 'name' | 'order'>) {
  const aNumber = getLeagueTroopNameNumber(a.name);
  const bNumber = getLeagueTroopNameNumber(b.name);
  if (aNumber !== null && bNumber !== null) {
    if (aNumber !== bNumber) {
      return aNumber - bNumber;
    }
    return a.name.localeCompare(b.name, 'cs', { sensitivity: 'base' });
  }
  if (aNumber !== null) {
    return -1;
  }
  if (bNumber !== null) {
    return 1;
  }
  return a.name.localeCompare(b.name, 'cs', { sensitivity: 'base' }) || a.order - b.order;
}

function cloneLeagueScores(source: LeagueScoresRecord): LeagueScoresRecord {
  const next: LeagueScoresRecord = {};
  Object.entries(source).forEach(([troopId, scores]) => {
    next[troopId] = { ...(scores ?? {}) };
  });
  return next;
}

function cloneLeagueTroops(troops: LeagueTroopEntry[] = LEAGUE_TROOPS): LeagueTroopEntry[] {
  return troops.map((troop, index) => ({
    id: troop.id,
    name: troop.name,
    order: troop.order ?? index,
  }));
}

function cloneLeagueEvents(events: LeagueEventEntry[] = LEAGUE_EVENTS): LeagueEventEntry[] {
  return events.map((event, index) => ({
    key: event.key,
    label: event.label,
    name: event.name,
    order: event.order ?? index,
  }));
}

function createDefaultLeagueSeason(): LeagueSeason {
  return {
    id: DEFAULT_LEAGUE_SEASON_ID,
    name: DEFAULT_LEAGUE_SEASON_NAME,
    isActive: true,
    startsOn: '2025-09-01',
    endsOn: '2026-06-30',
    troops: cloneLeagueTroops(),
    events: cloneLeagueEvents(),
    scores: cloneLeagueScores(CURRENT_LEAGUE_SCORES),
  };
}

function createDefaultLeagueData(): LeagueData {
  const season = createDefaultLeagueSeason();
  return {
    seasons: [season],
    activeSeasonId: season.id,
  };
}

function getActiveLeagueSeason(leagueData: LeagueData): LeagueSeason {
  return (
    leagueData.seasons.find((season) => season.id === leagueData.activeSeasonId) ??
    leagueData.seasons.find((season) => season.isActive) ??
    leagueData.seasons[0] ??
    createDefaultLeagueSeason()
  );
}

function buildLeagueScoreRecord(
  entries: LeagueScoreEntry[] | null | undefined,
  fallback: LeagueScoresRecord,
  troops: LeagueTroopEntry[] = LEAGUE_TROOPS,
): LeagueScoresRecord {
  if (!entries || entries.length === 0) {
    return cloneLeagueScores(fallback);
  }
  const record: LeagueScoresRecord = {};
  troops.forEach((troop) => {
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

function normalizeLeagueEvents(rawEvents: unknown): LeagueEventEntry[] {
  if (!Array.isArray(rawEvents) || rawEvents.length === 0) {
    return cloneLeagueEvents();
  }
  const seen = new Set<string>();
  const events = rawEvents
    .map((event: any, index: number): LeagueEventEntry | null => {
      const rawName = typeof event?.name === 'string' ? event.name.trim() : '';
      const rawLabel = typeof event?.label === 'string' ? event.label.trim() : '';
      const rawKey =
        typeof event?.key === 'string' && event.key.trim()
          ? event.key.trim()
          : typeof event?.event_key === 'string' && event.event_key.trim()
            ? event.event_key.trim()
            : '';
      const name = rawName || rawLabel || rawKey;
      const label = rawLabel || rawName || rawKey;
      const key = rawKey || slugify(name);
      if (!key || !name || seen.has(key)) {
        return null;
      }
      seen.add(key);
      const orderRaw = Number(event.order ?? event.order_index ?? index);
      return {
        key,
        label,
        name,
        order: Number.isFinite(orderRaw) ? orderRaw : index,
      };
    })
    .filter((event: LeagueEventEntry | null): event is LeagueEventEntry => Boolean(event))
    .sort((a: LeagueEventEntry, b: LeagueEventEntry) => (a.order ?? 0) - (b.order ?? 0));
  return events.length > 0 ? events : cloneLeagueEvents();
}

function normalizeLeagueData(raw: any): LeagueData {
  const fallback = createDefaultLeagueData();
  const rawSeasons = Array.isArray(raw?.seasons) ? raw.seasons : [];
  if (rawSeasons.length === 0) {
    const entries = Array.isArray(raw?.scores) ? (raw.scores as LeagueScoreEntry[]) : [];
    return {
      seasons: [{
        ...fallback.seasons[0],
        scores: buildLeagueScoreRecord(entries, CURRENT_LEAGUE_SCORES),
      }],
      activeSeasonId: DEFAULT_LEAGUE_SEASON_ID,
    };
  }

  const seasons: LeagueSeason[] = rawSeasons
    .map((season: any, seasonIndex: number): LeagueSeason | null => {
      const id = typeof season?.id === 'string' && season.id.trim() ? season.id.trim() : '';
      const name = typeof season?.name === 'string' && season.name.trim() ? season.name.trim() : id;
      if (!id || !name) {
        return null;
      }
      const rawTroops = Array.isArray(season.troops) ? season.troops : [];
      const troops: LeagueTroopEntry[] = rawTroops.length > 0
        ? rawTroops
          .map((troop: any, troopIndex: number): LeagueTroopEntry | null => {
            const troopId = typeof troop?.id === 'string' && troop.id.trim()
              ? troop.id.trim()
              : typeof troop?.troop_id === 'string' && troop.troop_id.trim()
                ? troop.troop_id.trim()
                : '';
            const troopName = typeof troop?.name === 'string' && troop.name.trim()
              ? troop.name.trim()
              : typeof troop?.troop_name === 'string' && troop.troop_name.trim()
                ? troop.troop_name.trim()
                : '';
            if (!troopId || !troopName) {
              return null;
            }
            const orderRaw = Number(troop.order ?? troop.order_index ?? troopIndex);
            return {
              id: troopId,
              name: troopName,
              order: Number.isFinite(orderRaw) ? orderRaw : troopIndex,
            };
          })
          .filter((troop: LeagueTroopEntry | null): troop is LeagueTroopEntry => Boolean(troop))
          .sort((a: LeagueTroopEntry, b: LeagueTroopEntry) => (a.order ?? 0) - (b.order ?? 0))
        : cloneLeagueTroops();
      const fallbackScores = seasonIndex === 0 ? CURRENT_LEAGUE_SCORES : {};
      const scoreEntries = Array.isArray(season.scores) ? (season.scores as LeagueScoreEntry[]) : [];
      const events = normalizeLeagueEvents(season.events);
      return {
        id,
        name,
        isActive: season.isActive === true || season.is_active === true,
        startsOn: typeof season.startsOn === 'string' ? season.startsOn : season.starts_on ?? null,
        endsOn: typeof season.endsOn === 'string' ? season.endsOn : season.ends_on ?? null,
        troops,
        events,
        scores: buildLeagueScoreRecord(scoreEntries, fallbackScores, troops),
      };
    })
    .filter((season: LeagueSeason | null): season is LeagueSeason => Boolean(season));

  if (seasons.length === 0) {
    return fallback;
  }
  const activeSeasonId =
    typeof raw?.activeSeasonId === 'string' && seasons.some((season) => season.id === raw.activeSeasonId)
      ? raw.activeSeasonId
      : seasons.find((season) => season.isActive)?.id ?? seasons[0].id;
  return { seasons, activeSeasonId };
}

function buildLeagueRows(
  scores: LeagueScoresRecord = CURRENT_LEAGUE_SCORES,
  troops: LeagueTroopEntry[] = LEAGUE_TROOPS,
  events: LeagueEventEntry[] = LEAGUE_EVENTS,
): LeagueRow[] {
  return troops.map((troop, index) => {
    const troopScores = scores[troop.id] ?? {};
    const scoreValues = events.map((event) => troopScores[event.key] ?? null);
    const hasScores = scoreValues.some((value) => value !== null);
    const total = hasScores ? scoreValues.reduce<number>((sum, value) => sum + (value ?? 0), 0) : null;
    return {
      key: troop.id,
      name: troop.name,
      scores: scoreValues,
      total,
      order: troop.order ?? index,
    };
  }).sort((a, b) => {
    if (a.total === null && b.total === null) {
      return compareLeagueRowsByTroopNumber(a, b);
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
    return 'domu';
  }
  const slug = segments[0];
  if (slug === 'souteze' || slug === 'aplikace' || COMPETITIONS.some((event) => event.slug === slug)) {
    return 'souteze';
  }
  if (slug === 'aktualni-poradi' || slug === 'zelena-liga') {
    return 'aktualni-poradi';
  }
  if (slug === 'plan-akci') {
    return 'plan-akci';
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

function createEmptyPersonalDrinkCounts(): PersonalDrinkCounts {
  return createEmptyAfterpartyCounts();
}

function isPersonalDrinkKey(value: unknown): value is PersonalDrinkKey {
  return typeof value === 'string' && AFTERPARTY_DRINK_BY_KEY.has(value);
}

function sanitizePersonalDrinkSelection(value: unknown): PersonalDrinkKey[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const selected: PersonalDrinkKey[] = [];
  for (const candidate of value) {
    if (isPersonalDrinkKey(candidate) && !selected.includes(candidate)) {
      selected.push(candidate);
    }
  }
  return selected;
}

function parseAfterpartyNonNegativeInt(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(0, Math.round(value));
  }
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) {
      return Math.max(0, parsed);
    }
  }
  return fallback;
}

function normalizeAfterpartyTroopName(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return '';
  }
  return AFTERPARTY_TROOP_OPTIONS.some((option) => option === trimmed) ? trimmed : '';
}

function loadPersonalDrinkStateFromStorage(): PersonalDrinkStorageState {
  const defaults = createEmptyPersonalDrinkCounts();
  if (typeof window === 'undefined') {
    return { selected: [], counts: defaults };
  }

  try {
    const raw = window.localStorage.getItem(AFTERPARTY_STORAGE_KEY);
    if (!raw) {
      return { selected: [], counts: defaults };
    }

    const parsed = JSON.parse(raw) as unknown;
    const parsedObject =
      parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : ({} as Record<string, unknown>);
    const parsedCounts =
      parsedObject.counts && typeof parsedObject.counts === 'object'
        ? (parsedObject.counts as Record<string, unknown>)
        : parsedObject;
    const counts: PersonalDrinkCounts = AFTERPARTY_DRINK_ITEMS.reduce<PersonalDrinkCounts>((acc, item) => {
      acc[item.key] = parseAfterpartyNonNegativeInt(parsedCounts[item.key], defaults[item.key]);
      return acc;
    }, {});
    const selected = sanitizePersonalDrinkSelection(parsedObject.selected);
    if (selected.length > 0) {
      return { selected, counts };
    }

    const selectedFromCounts = AFTERPARTY_DRINK_ITEMS.filter((item) => counts[item.key] > 0).map((item) => item.key);
    return { selected: selectedFromCounts, counts };
  } catch {
    return { selected: [], counts: defaults };
  }
}

function formatAfterpartyDate(value: string | null | undefined) {
  if (!value) {
    return '';
  }
  return new Date(value).toLocaleString('cs-CZ', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatAfterpartyStatus(status: AfterpartyOrderStatus) {
  if (status === 'approved') {
    return 'Potvrzeno';
  }
  if (status === 'rejected') {
    return 'Zamítnuto';
  }
  return 'Čeká na kontrolu';
}

function afterpartyDraftKey(orderId: string, itemId: string): string {
  return `${orderId}:${itemId}`;
}

function getAfterpartyAdminDraftQuantity(
  draftQuantities: Record<string, string>,
  orderId: string,
  item: AfterpartyOrderItemRow,
): number {
  return parseAfterpartyNonNegativeInt(
    draftQuantities[afterpartyDraftKey(orderId, item.id)],
    item.approved_quantity ?? item.quantity ?? 0,
  );
}

function createAfterpartyReceiptPath(participantId: string, file: File) {
  const extension = file.name.split('.').pop()?.toLocaleLowerCase('cs').replace(/[^a-z0-9]/g, '') || 'bin';
  const id = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${participantId}/${id}.${extension}`;
}

function AfterpartyCounter({ open, onClose }: { open: boolean; onClose: () => void }) {
  const initialState = useMemo(() => loadPersonalDrinkStateFromStorage(), []);
  const [selectedDrinks, setSelectedDrinks] = useState<PersonalDrinkKey[]>(initialState.selected);
  const [counts, setCounts] = useState<PersonalDrinkCounts>(initialState.counts);
  const [menuOpen, setMenuOpen] = useState(false);
  const [activeDrinkCategory, setActiveDrinkCategory] = useState<AfterpartyDrinkCategory>(
    AFTERPARTY_DRINK_MENU[0]?.category ?? 'Pivo',
  );
  const [mode, setMode] = useState<AfterpartyCounterMode>('counter');
  const [participant, setParticipant] = useState<AfterpartyParticipant | null>(null);
  const [profileForm, setProfileForm] = useState({ displayName: '', troopName: '' });
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileEditing, setProfileEditing] = useState(false);
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [orders, setOrders] = useState<AfterpartyOrderRow[]>([]);
  const [individualLeaderboard, setIndividualLeaderboard] = useState<AfterpartyIndividualLeaderboardRow[]>([]);
  const [troopLeaderboard, setTroopLeaderboard] = useState<AfterpartyTroopLeaderboardRow[]>([]);
  const [leaderboardMode, setLeaderboardMode] = useState<'individuals' | 'troops'>('individuals');
  const [loadingOnline, setLoadingOnline] = useState(false);
  const [submittingOrder, setSubmittingOrder] = useState(false);
  const [afterpartyError, setAfterpartyError] = useState<string | null>(null);
  const [afterpartySuccess, setAfterpartySuccess] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    try {
      window.localStorage.setItem(AFTERPARTY_STORAGE_KEY, JSON.stringify({ selected: selectedDrinks, counts }));
    } catch {
      // Ignore localStorage write errors in private browsing or blocked contexts.
    }
  }, [counts, selectedDrinks]);

  useEffect(() => {
    if (!open) {
      setMode('counter');
      setMenuOpen(false);
      setAfterpartyError(null);
      setAfterpartySuccess(null);
      return;
    }
    setAfterpartyError(null);
    setAfterpartySuccess(null);
  }, [open]);

  const loadLeaderboards = useCallback(async () => {
    const [individualRes, troopRes] = await Promise.all([
      supabase
        .from('afterparty_individual_leaderboard')
        .select('participant_id, display_name, troop_name, total_points, approved_orders')
        .gt('total_points', 0)
        .order('total_points', { ascending: false })
        .order('display_name', { ascending: true })
        .limit(50),
      supabase
        .from('afterparty_troop_leaderboard')
        .select('troop_name, total_points, participants, approved_orders')
        .gt('total_points', 0)
        .order('total_points', { ascending: false })
        .order('troop_name', { ascending: true })
        .limit(50),
    ]);

    if (individualRes.error) {
      throw individualRes.error;
    }
    if (troopRes.error) {
      throw troopRes.error;
    }

    setIndividualLeaderboard((individualRes.data ?? []) as AfterpartyIndividualLeaderboardRow[]);
    setTroopLeaderboard((troopRes.data ?? []) as AfterpartyTroopLeaderboardRow[]);
  }, []);

  const loadParticipantOrders = useCallback(async (participantId: string) => {
    const { data, error } = await supabase
      .from('afterparty_orders')
      .select(
        'id, participant_id, status, receipt_path, total_points, review_note, submitted_at, reviewed_at, afterparty_order_items(id, drink_key, label, category, quantity, approved_quantity, points_each, points_total)',
      )
      .eq('participant_id', participantId)
      .order('submitted_at', { ascending: false })
      .limit(20);

    if (error) {
      throw error;
    }
    setOrders((data ?? []) as AfterpartyOrderRow[]);
  }, []);

  const loadAfterpartyOnlineState = useCallback(async () => {
    if (typeof window === 'undefined') {
      return;
    }

    setLoadingOnline(true);
    setAfterpartyError(null);
    try {
      const participantId = window.localStorage.getItem(AFTERPARTY_PARTICIPANT_STORAGE_KEY);
      let loadedParticipant: AfterpartyParticipant | null = null;

      if (participantId) {
        const { data, error } = await supabase
          .from('afterparty_participants')
          .select('id, display_name, troop_name')
          .eq('id', participantId)
          .maybeSingle();

        if (error) {
          throw error;
        }
        if (data) {
          loadedParticipant = data as AfterpartyParticipant;
          setParticipant(loadedParticipant);
          setProfileForm({
            displayName: loadedParticipant.display_name,
            troopName: normalizeAfterpartyTroopName(loadedParticipant.troop_name),
          });
          setProfileEditing(false);
          await loadParticipantOrders(loadedParticipant.id);
        } else {
          window.localStorage.removeItem(AFTERPARTY_PARTICIPANT_STORAGE_KEY);
          setParticipant(null);
          setOrders([]);
          setProfileEditing(true);
        }
      } else {
        setParticipant(null);
        setOrders([]);
        setProfileEditing(true);
      }

      await loadLeaderboards();
    } catch (error) {
      console.error('Failed to load afterparty league', error);
      setAfterpartyError('Online liga se nepodařila načíst. Zkontroluj připojení a zkus to znovu.');
    } finally {
      setLoadingOnline(false);
    }
  }, [loadLeaderboards, loadParticipantOrders]);

  useEffect(() => {
    if (open && mode === 'league') {
      void loadAfterpartyOnlineState();
    }
  }, [loadAfterpartyOnlineState, mode, open]);

  useEffect(() => {
    if (!open || typeof window === 'undefined') {
      return;
    }
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (menuOpen) {
          setMenuOpen(false);
          return;
        }
        onClose();
      }
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [menuOpen, open, onClose]);

  const adjustDrinkCount = (drink: PersonalDrinkKey, delta: number) => {
    if (!delta) {
      return;
    }
    setCounts((prev) => ({
      ...prev,
      [drink]: Math.max(0, (prev[drink] ?? 0) + delta),
    }));
  };

  const addDrinkOrder = (drink: PersonalDrinkKey) => {
    setSelectedDrinks((prev) => (prev.includes(drink) ? prev : [...prev, drink]));
    setCounts((prev) => ({
      ...prev,
      [drink]: Math.max(0, (prev[drink] ?? 0) + 1),
    }));
    setMenuOpen(false);
  };

  const removeDrink = (drink: PersonalDrinkKey) => {
    setSelectedDrinks((prev) => prev.filter((key) => key !== drink));
    setCounts((prev) => ({
      ...prev,
      [drink]: 0,
    }));
  };

  const handleResetAll = () => {
    const confirmed = window.confirm('Opravdu resetovat celé počítadlo?');
    if (!confirmed) {
      return;
    }
    setCounts(createEmptyPersonalDrinkCounts());
    setSelectedDrinks([]);
    setMenuOpen(false);
  };

  const handleModeChange = (nextMode: AfterpartyCounterMode) => {
    setMode(nextMode);
    setAfterpartyError(null);
    setAfterpartySuccess(null);
  };

  const handleProfileSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const displayName = profileForm.displayName.trim();
    const troopName = profileForm.troopName.trim();
    if (!displayName || !troopName) {
      setAfterpartyError('Vyplň jméno i oddíl.');
      return;
    }

    setProfileSaving(true);
    setAfterpartyError(null);
    setAfterpartySuccess(null);
    try {
      const payload = {
        display_name: displayName,
        troop_name: troopName,
      };
      const result = participant
        ? await supabase
          .from('afterparty_participants')
          .update(payload)
          .eq('id', participant.id)
          .select('id, display_name, troop_name')
          .single()
        : await supabase
          .from('afterparty_participants')
          .insert(payload)
          .select('id, display_name, troop_name')
          .single();

      if (result.error) {
        throw result.error;
      }
      const saved = result.data as AfterpartyParticipant;
      setParticipant(saved);
      setProfileForm({
        displayName: saved.display_name,
        troopName: normalizeAfterpartyTroopName(saved.troop_name),
      });
      setProfileEditing(false);
      window.localStorage.setItem(AFTERPARTY_PARTICIPANT_STORAGE_KEY, saved.id);
      setAfterpartySuccess('Profil je uložený.');
      await loadParticipantOrders(saved.id);
      await loadLeaderboards();
    } catch (error) {
      console.error('Failed to save afterparty participant', error);
      setAfterpartyError('Profil se nepodařilo uložit.');
    } finally {
      setProfileSaving(false);
    }
  };

  const handleSubmitOrder = async () => {
    if (!participant) {
      setAfterpartyError('Nejdřív ulož jméno a oddíl.');
      setProfileEditing(true);
      return;
    }
    const orderItems = AFTERPARTY_DRINK_ITEMS
      .map((drink) => ({
        drink,
        quantity: Math.max(0, counts[drink.key] ?? 0),
      }))
      .filter((item) => item.quantity > 0);
    if (!orderItems.length) {
      setAfterpartyError('Přidej aspoň jednu položku.');
      return;
    }
    if (!receiptFile) {
      setAfterpartyError('Nahraj fotku nebo PDF účtenky.');
      return;
    }
    const allowedReceipt = receiptFile.type.startsWith('image/') || receiptFile.type === 'application/pdf';
    if (!allowedReceipt) {
      setAfterpartyError('Účtenka musí být obrázek nebo PDF.');
      return;
    }

    setSubmittingOrder(true);
    setAfterpartyError(null);
    setAfterpartySuccess(null);
    try {
      const receiptPath = createAfterpartyReceiptPath(participant.id, receiptFile);
      const { error: uploadError } = await supabase.storage
        .from(AFTERPARTY_RECEIPTS_BUCKET)
        .upload(receiptPath, receiptFile, {
          contentType: receiptFile.type || undefined,
          upsert: false,
        });
      if (uploadError) {
        throw uploadError;
      }

      const { data: order, error: orderError } = await supabase
        .from('afterparty_orders')
        .insert({
          participant_id: participant.id,
          receipt_path: receiptPath,
          status: 'pending',
          total_points: 0,
        })
        .select('id')
        .single();
      if (orderError) {
        throw orderError;
      }

      const orderId = (order as { id: string }).id;
      const rows = orderItems.map(({ drink, quantity }) => ({
        order_id: orderId,
        drink_key: drink.key,
        label: drink.label,
        category: drink.category,
        quantity,
        approved_quantity: quantity,
        points_each: drink.points,
        points_total: quantity * drink.points,
      }));
      const { error: itemsError } = await supabase.from('afterparty_order_items').insert(rows);
      if (itemsError) {
        throw itemsError;
      }

      setCounts(createEmptyPersonalDrinkCounts());
      setSelectedDrinks([]);
      setReceiptFile(null);
      setAfterpartySuccess('Objednávka je odeslaná ke kontrole.');
      await loadParticipantOrders(participant.id);
      await loadLeaderboards();
    } catch (error) {
      console.error('Failed to submit afterparty order', error);
      setAfterpartyError('Objednávku se nepodařilo odeslat.');
    } finally {
      setSubmittingOrder(false);
    }
  };

  const selectedItems = AFTERPARTY_DRINK_ITEMS.filter((drink) => selectedDrinks.includes(drink.key));
  const activeCategoryItems = AFTERPARTY_DRINK_ITEMS.filter((drink) => drink.category === activeDrinkCategory);
  const draftPoints = calculateAfterpartyPoints(counts);
  const draftItemCount = selectedItems.reduce((sum, drink) => sum + Math.max(0, counts[drink.key] ?? 0), 0);
  const activeLeaderboard =
    leaderboardMode === 'individuals' ? individualLeaderboard : troopLeaderboard;

  if (!open) {
    return null;
  }

  return (
    <div
      className="homepage-afterparty-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="afterparty-counter-title"
      onClick={onClose}
    >
      <div className="homepage-afterparty-panel" onClick={(event) => event.stopPropagation()}>
        <div className="homepage-afterparty-header">
          <h2 id="afterparty-counter-title">Pivečko počítadlo</h2>
          <button type="button" className="homepage-afterparty-close" onClick={onClose}>
            Zavřít
          </button>
        </div>

        <div className="homepage-afterparty-mode-switch homepage-afterparty-segmented" aria-label="Režim počítadla">
          <button
            type="button"
            className={mode === 'counter' ? 'is-active' : ''}
            onClick={() => handleModeChange('counter')}
          >
            Jen počítat
          </button>
          <button
            type="button"
            className={mode === 'league' ? 'is-active' : ''}
            onClick={() => handleModeChange('league')}
          >
            Soutěžit
          </button>
        </div>

        {afterpartyError ? <p className="homepage-afterparty-alert is-error">{afterpartyError}</p> : null}
        {afterpartySuccess ? <p className="homepage-afterparty-alert is-success">{afterpartySuccess}</p> : null}
        {loadingOnline && mode === 'league' ? (
          <p className="homepage-afterparty-empty">Načítám online ligu…</p>
        ) : null}

        {mode === 'league' ? (
          <section className="homepage-afterparty-section">
            <div className="homepage-afterparty-section-head">
              <h3>Profil</h3>
              {participant && !profileEditing ? (
                <button type="button" className="homepage-afterparty-inline-button" onClick={() => setProfileEditing(true)}>
                  Upravit
                </button>
              ) : null}
            </div>
            {participant && !profileEditing ? (
              <div className="homepage-afterparty-profile-summary">
                <strong>{participant.display_name}</strong>
                <span>{participant.troop_name}</span>
              </div>
            ) : (
              <form className="homepage-afterparty-profile-form" onSubmit={handleProfileSubmit}>
                <label>
                  <span>Jméno</span>
                  <input
                    type="text"
                    value={profileForm.displayName}
                    maxLength={80}
                    onChange={(event) => setProfileForm((prev) => ({ ...prev, displayName: event.target.value }))}
                  />
                </label>
                <label>
                  <span>Oddíl</span>
                  <select
                    value={profileForm.troopName}
                    onChange={(event) => setProfileForm((prev) => ({ ...prev, troopName: event.target.value }))}
                  >
                    <option value="">Vyber oddíl</option>
                    {AFTERPARTY_TROOP_OPTIONS.map((troopName) => (
                      <option key={troopName} value={troopName}>
                        {troopName}
                      </option>
                    ))}
                  </select>
                </label>
                <button type="submit" className="homepage-afterparty-add-order" disabled={profileSaving}>
                  {profileSaving ? 'Ukládám…' : 'Uložit profil'}
                </button>
              </form>
            )}
          </section>
        ) : null}

        <section className="homepage-afterparty-section homepage-afterparty-section-users">
          <div className="homepage-afterparty-section-head">
            <h3>Moje počítadlo</h3>
            <button type="button" className="homepage-afterparty-add-order" onClick={() => setMenuOpen(true)}>
              + Přidat položku
            </button>
          </div>
          {selectedItems.length === 0 ? (
            <p className="homepage-afterparty-empty">Zatím nic nepřidaného.</p>
          ) : (
            <div className="homepage-afterparty-drink-grid">
              {selectedItems.map((drink) => (
                <article
                  key={drink.key}
                  className="homepage-afterparty-drink-cell"
                  role="button"
                  tabIndex={0}
                  onClick={() => adjustDrinkCount(drink.key, 1)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      adjustDrinkCount(drink.key, 1);
                    }
                  }}
                >
                  <div className="homepage-afterparty-drink-top">
                    <h4>{drink.label}</h4>
                    <strong>{counts[drink.key]}</strong>
                  </div>
                  {mode === 'league' ? (
                    <p className="homepage-afterparty-card-meta">{drink.points} bodů za kus</p>
                  ) : null}
                  <div className="homepage-afterparty-drink-actions">
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        adjustDrinkCount(drink.key, -1);
                      }}
                    >
                      -
                    </button>
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        adjustDrinkCount(drink.key, 1);
                      }}
                    >
                      +
                    </button>
                    <button
                      type="button"
                      className="homepage-afterparty-remove"
                      onClick={(event) => {
                        event.stopPropagation();
                        removeDrink(drink.key);
                      }}
                    >
                      Odebrat položku
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
          <div className="homepage-afterparty-reset-wrap">
            <button type="button" className="homepage-afterparty-reset" onClick={handleResetAll}>
              Resetovat vše
            </button>
          </div>
          {mode === 'league' && draftItemCount > 0 ? (
            <div className="homepage-afterparty-submit-box">
              <p>
                Aktuálně {draftItemCount} položek za <strong>{draftPoints} bodů</strong>.
              </p>
              <label className="homepage-afterparty-file-field">
                <span>Účtenka</span>
                <input
                  type="file"
                  accept="image/*,application/pdf"
                  onChange={(event) => setReceiptFile(event.target.files?.[0] ?? null)}
                />
              </label>
              {receiptFile ? <p className="homepage-afterparty-empty">Vybráno: {receiptFile.name}</p> : null}
              <button
                type="button"
                className="homepage-afterparty-add-order"
                onClick={handleSubmitOrder}
                disabled={submittingOrder}
              >
                {submittingOrder ? 'Odesílám…' : 'Zaplaceno a odeslat ke kontrole'}
              </button>
            </div>
          ) : null}
        </section>

        {mode === 'league' ? (
          <>
            <section className="homepage-afterparty-section">
              <div className="homepage-afterparty-section-head">
                <h3>Moje účtenky</h3>
                <button
                  type="button"
                  className="homepage-afterparty-inline-button"
                  onClick={loadAfterpartyOnlineState}
                  disabled={loadingOnline}
                >
                  {loadingOnline ? 'Načítám…' : 'Obnovit'}
                </button>
              </div>
              {orders.length === 0 ? (
                <p className="homepage-afterparty-empty">Zatím nemáš žádnou odeslanou účtenku.</p>
              ) : (
                <div className="homepage-afterparty-order-list">
                  {orders.map((order) => (
                    <article key={order.id} className={`homepage-afterparty-order is-${order.status}`}>
                      <div className="homepage-afterparty-order-head">
                        <strong>{formatAfterpartyStatus(order.status)}</strong>
                        <span>{formatAfterpartyDate(order.submitted_at)}</span>
                      </div>
                      <p>
                        {order.status === 'approved'
                          ? `${order.total_points} bodů`
                          : order.status === 'rejected'
                            ? 'Bez bodů'
                            : 'Body se připíšou po kontrole'}
                      </p>
                      <div className="homepage-afterparty-order-items">
                        {(order.afterparty_order_items ?? []).map((item) => (
                          <span key={item.id}>
                            {item.label} × {order.status === 'approved' ? item.approved_quantity : item.quantity}
                          </span>
                        ))}
                      </div>
                      {order.review_note ? <p className="homepage-afterparty-empty">{order.review_note}</p> : null}
                    </article>
                  ))}
                </div>
              )}
            </section>

            <section className="homepage-afterparty-section">
              <div className="homepage-afterparty-section-head">
                <h3>Pořadí</h3>
                <div className="homepage-afterparty-segmented">
                  <button
                    type="button"
                    className={leaderboardMode === 'individuals' ? 'is-active' : ''}
                    onClick={() => setLeaderboardMode('individuals')}
                  >
                    Lidi
                  </button>
                  <button
                    type="button"
                    className={leaderboardMode === 'troops' ? 'is-active' : ''}
                    onClick={() => setLeaderboardMode('troops')}
                  >
                    Oddíly
                  </button>
                </div>
              </div>
              {activeLeaderboard.length === 0 ? (
                <p className="homepage-afterparty-empty">Zatím nejsou potvrzené žádné body.</p>
              ) : (
                <ol className="homepage-afterparty-leaderboard">
                  {leaderboardMode === 'individuals'
                    ? (activeLeaderboard as AfterpartyIndividualLeaderboardRow[]).map((row) => (
                      <li key={row.participant_id}>
                        <span>
                          <strong>{row.display_name}</strong>
                          <small>{row.troop_name}</small>
                        </span>
                        <strong>{row.total_points}</strong>
                      </li>
                    ))
                    : (activeLeaderboard as AfterpartyTroopLeaderboardRow[]).map((row) => (
                      <li key={row.troop_name}>
                        <span>
                          <strong>{row.troop_name}</strong>
                          <small>{row.participants} lidí</small>
                        </span>
                        <strong>{row.total_points}</strong>
                      </li>
                    ))}
                </ol>
              )}
            </section>
          </>
        ) : null}

        {menuOpen ? (
          <div className="homepage-afterparty-menu-backdrop" onClick={() => setMenuOpen(false)}>
            <div
              className="homepage-afterparty-menu-panel"
              role="dialog"
              aria-label="Přidat položku"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="homepage-afterparty-menu-header">
                <h3>Přidat položku</h3>
                <button type="button" className="homepage-afterparty-close" onClick={() => setMenuOpen(false)}>
                  Zavřít
                </button>
              </div>

              <div className="homepage-afterparty-category-tabs" role="tablist" aria-label="Kategorie položek">
                {AFTERPARTY_DRINK_MENU.map((section) => {
                  const isActive = section.category === activeDrinkCategory;
                  return (
                    <button
                      key={section.category}
                      type="button"
                      role="tab"
                      aria-selected={isActive}
                      className={`homepage-afterparty-category-tab${isActive ? ' is-active' : ''}`}
                      onClick={() => setActiveDrinkCategory(section.category)}
                    >
                      {section.category}
                    </button>
                  );
                })}
              </div>

              <div className="homepage-afterparty-menu-block">
                <h4>{activeDrinkCategory}</h4>
                <div className="homepage-afterparty-menu-grid">
                  {activeCategoryItems.map((drink) => (
                    <button
                      key={drink.key}
                      type="button"
                      className="homepage-afterparty-menu-item"
                      onClick={() => addDrinkOrder(drink.key)}
                    >
                      <span>{drink.label}</span>
                      {mode === 'league' ? <small>{drink.points} bodů</small> : null}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function AfterpartyAdminManager({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [sessionState, setSessionState] = useState<AfterpartyAdminSessionState>('checking');
  const [password, setPassword] = useState('');
  const [orders, setOrders] = useState<AfterpartyAdminOrderRow[]>([]);
  const [draftQuantities, setDraftQuantities] = useState<Record<string, string>>({});
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [savingOrderId, setSavingOrderId] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const applyOrders = useCallback((nextOrders: AfterpartyAdminOrderRow[]) => {
    setOrders(nextOrders);
    const nextQuantities: Record<string, string> = {};
    const nextNotes: Record<string, string> = {};
    nextOrders.forEach((order) => {
      nextNotes[order.id] = order.review_note ?? '';
      (order.afterparty_order_items ?? []).forEach((item) => {
        nextQuantities[afterpartyDraftKey(order.id, item.id)] = String(item.approved_quantity ?? item.quantity ?? 0);
      });
    });
    setDraftQuantities(nextQuantities);
    setReviewNotes(nextNotes);
  }, []);

  const loadOrders = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/content/admin/afterparty/orders', {
        credentials: 'include',
      });
      if (response.status === 401) {
        setSessionState('unauthorized');
        return;
      }
      const body = (await response.json().catch(() => null)) as {
        orders?: AfterpartyAdminOrderRow[];
        error?: string;
      } | null;
      if (!response.ok) {
        throw new Error(body?.error || 'Nepodařilo se načíst účtenky.');
      }
      applyOrders(body?.orders ?? []);
      setSessionState('authorized');
    } catch (loadError) {
      console.error('Failed to load afterparty admin orders', loadError);
      setError(loadError instanceof Error && loadError.message ? loadError.message : 'Nepodařilo se načíst účtenky.');
    } finally {
      setLoading(false);
    }
  }, [applyOrders]);

  const checkSession = useCallback(async () => {
    setSessionState('checking');
    setError(null);
    try {
      const response = await fetch('/api/content/admin/session', { credentials: 'include' });
      if (!response.ok) {
        setSessionState('unauthorized');
        return;
      }
      setSessionState('authorized');
      await loadOrders();
    } catch (sessionError) {
      console.error('Failed to check content admin session', sessionError);
      setSessionState('unauthorized');
    }
  }, [loadOrders]);

  useEffect(() => {
    if (open) {
      setSuccess(null);
      void checkSession();
    }
  }, [checkSession, open]);

  useEffect(() => {
    if (!open || typeof window === 'undefined') {
      return;
    }
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [open, onClose]);

  const handleLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      const response = await fetch('/api/content/admin/login', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) {
        throw new Error(body?.error || 'Přihlášení se nepodařilo.');
      }
      setPassword('');
      setSessionState('authorized');
      await loadOrders();
    } catch (loginError) {
      console.error('Failed to log in to afterparty manager', loginError);
      setSessionState('unauthorized');
      setError(loginError instanceof Error && loginError.message ? loginError.message : 'Přihlášení se nepodařilo.');
    } finally {
      setLoading(false);
    }
  };

  const handleQuantityChange = (orderId: string, itemId: string, value: string) => {
    setDraftQuantities((prev) => ({
      ...prev,
      [afterpartyDraftKey(orderId, itemId)]: value,
    }));
  };

  const reviewOrder = async (order: AfterpartyAdminOrderRow, action: 'approve' | 'reject') => {
    if (action === 'reject' && !window.confirm('Opravdu zamítnout tuto účtenku?')) {
      return;
    }

    setSavingOrderId(order.id);
    setError(null);
    setSuccess(null);
    try {
      const response = await fetch(`/api/content/admin/afterparty/orders/${order.id}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          review_note: reviewNotes[order.id] ?? '',
          items: (order.afterparty_order_items ?? []).map((item) => ({
            id: item.id,
            approved_quantity: getAfterpartyAdminDraftQuantity(draftQuantities, order.id, item),
          })),
        }),
      });
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      if (response.status === 401) {
        setSessionState('unauthorized');
        throw new Error('Přihlášení vypršelo.');
      }
      if (!response.ok) {
        throw new Error(body?.error || 'Uložení kontroly se nepodařilo.');
      }
      setSuccess(action === 'approve' ? 'Účtenka byla potvrzena.' : 'Účtenka byla zamítnuta.');
      await loadOrders();
    } catch (reviewError) {
      console.error('Failed to review afterparty order', reviewError);
      setError(
        reviewError instanceof Error && reviewError.message
          ? reviewError.message
          : 'Uložení kontroly se nepodařilo.',
      );
    } finally {
      setSavingOrderId(null);
    }
  };

  const handleResetLeague = async () => {
    const confirmed = window.confirm(
      'Opravdu resetovat celou pivečko ligu? Smaže se pořadí, účastníci, účtenky i nahrané soubory.',
    );
    if (!confirmed) {
      return;
    }

    setResetting(true);
    setError(null);
    setSuccess(null);
    try {
      const response = await fetch('/api/content/admin/afterparty/reset', {
        method: 'POST',
        credentials: 'include',
      });
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      if (response.status === 401) {
        setSessionState('unauthorized');
        throw new Error('Přihlášení vypršelo.');
      }
      if (!response.ok) {
        throw new Error(body?.error || 'Reset ligy se nepodařil.');
      }
      applyOrders([]);
      setSuccess('Pivečko liga byla resetována.');
    } catch (resetError) {
      console.error('Failed to reset afterparty league', resetError);
      setError(resetError instanceof Error && resetError.message ? resetError.message : 'Reset ligy se nepodařil.');
    } finally {
      setResetting(false);
    }
  };

  const pendingOrders = orders.filter((order) => order.status === 'pending');
  const reviewedOrders = orders
    .filter((order) => order.status !== 'pending')
    .sort((a, b) => {
      const dateA = Date.parse(a.reviewed_at ?? a.submitted_at);
      const dateB = Date.parse(b.reviewed_at ?? b.submitted_at);
      return (Number.isFinite(dateB) ? dateB : 0) - (Number.isFinite(dateA) ? dateA : 0);
    });

  const renderAdminReceipt = (order: AfterpartyAdminOrderRow) => {
    const signedUrl = order.receipt_signed_url ?? '';
    const receiptLooksLikeImage = /\.(?:jpe?g|png|webp)(?:\?|$)/i.test(signedUrl || order.receipt_path);

    if (signedUrl && receiptLooksLikeImage) {
      return (
        <a href={signedUrl} target="_blank" rel="noreferrer">
          <img src={signedUrl} alt="Nahraná účtenka" />
        </a>
      );
    }
    if (signedUrl) {
      return (
        <a className="homepage-afterparty-inline-button" href={signedUrl} target="_blank" rel="noreferrer">
          Otevřít účtenku
        </a>
      );
    }
    return <span className="homepage-afterparty-empty">Náhled účtenky není dostupný.</span>;
  };

  if (!open) {
    return null;
  }

  return (
    <div
      className="homepage-afterparty-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="afterparty-admin-title"
      onClick={onClose}
    >
      <div className="homepage-afterparty-panel" onClick={(event) => event.stopPropagation()}>
        <div className="homepage-afterparty-header">
          <h2 id="afterparty-admin-title">Správa pivečko ligy</h2>
          <button type="button" className="homepage-afterparty-close" onClick={onClose}>
            Zavřít
          </button>
        </div>

        {error ? <p className="homepage-afterparty-alert is-error">{error}</p> : null}
        {success ? <p className="homepage-afterparty-alert is-success">{success}</p> : null}

        {sessionState === 'checking' ? (
          <section className="homepage-afterparty-section">
            <p className="homepage-afterparty-empty">Ověřuji přihlášení…</p>
          </section>
        ) : null}

        {sessionState === 'unauthorized' ? (
          <section className="homepage-afterparty-section">
            <h3>Přihlášení</h3>
            <form className="homepage-afterparty-profile-form" onSubmit={handleLogin}>
              <label>
                <span>Heslo do redakce</span>
                <input
                  type="password"
                  value={password}
                  autoComplete="current-password"
                  onChange={(event) => setPassword(event.target.value)}
                />
              </label>
              <button type="submit" className="homepage-afterparty-add-order" disabled={loading}>
                {loading ? 'Přihlašuji…' : 'Přihlásit'}
              </button>
            </form>
          </section>
        ) : null}

        {sessionState === 'authorized' ? (
          <>
            <section className="homepage-afterparty-section">
              <div className="homepage-afterparty-admin-toolbar">
                <button type="button" className="homepage-afterparty-inline-button" onClick={loadOrders} disabled={loading}>
                  {loading ? 'Načítám…' : 'Obnovit účtenky'}
                </button>
                <button
                  type="button"
                  className="homepage-afterparty-reset"
                  onClick={handleResetLeague}
                  disabled={resetting}
                >
                  {resetting ? 'Resetuji…' : 'Resetovat ligu'}
                </button>
              </div>
            </section>

            <section className="homepage-afterparty-section">
              <div className="homepage-afterparty-section-head">
                <h3>Ke kontrole</h3>
              </div>
              {pendingOrders.length === 0 && !loading ? (
                <p className="homepage-afterparty-empty">Žádné účtenky ke kontrole.</p>
              ) : null}
              {pendingOrders.length > 0 ? (
                <div className="homepage-afterparty-admin-list">
                  {pendingOrders.map((order) => {
                    const participant = order.afterparty_participants ?? null;
                    const items = order.afterparty_order_items ?? [];
                    const isSaving = savingOrderId === order.id;
                    const previewPoints = items.reduce(
                      (sum, item) =>
                        sum
                        + getAfterpartyAdminDraftQuantity(draftQuantities, order.id, item)
                        * Math.max(0, Math.round(item.points_each ?? 0)),
                      0,
                    );

                    return (
                      <article key={order.id} className={`homepage-afterparty-admin-order is-${order.status}`}>
                        <div className="homepage-afterparty-admin-order-head">
                          <div>
                            <h3>{participant?.display_name ?? 'Neznámý účastník'}</h3>
                            <p>
                              {participant?.troop_name ?? 'Bez oddílu'} · {formatAfterpartyDate(order.submitted_at)}
                            </p>
                          </div>
                          <span className={`homepage-afterparty-admin-status is-${order.status}`}>
                            {formatAfterpartyStatus(order.status)}
                          </span>
                        </div>

                        <div className="homepage-afterparty-admin-receipt">
                          {renderAdminReceipt(order)}
                        </div>

                        <div className="homepage-afterparty-admin-items">
                          {items.map((item) => {
                            const inputId = `afterparty-admin-${order.id}-${item.id}`;
                            return (
                              <label key={item.id} className="homepage-afterparty-admin-item" htmlFor={inputId}>
                                <span>
                                  <strong>{item.label}</strong>
                                  <small>
                                    {item.category} · nahlášeno {item.quantity} · {item.points_each} bodů za kus
                                  </small>
                                </span>
                                <input
                                  id={inputId}
                                  type="number"
                                  min="0"
                                  step="1"
                                  inputMode="numeric"
                                  value={draftQuantities[afterpartyDraftKey(order.id, item.id)] ?? String(item.quantity)}
                                  onChange={(event) => handleQuantityChange(order.id, item.id, event.target.value)}
                                />
                              </label>
                            );
                          })}
                        </div>

                        <label className="homepage-afterparty-admin-note" htmlFor={`afterparty-admin-note-${order.id}`}>
                          <span>Poznámka pro účastníka</span>
                          <textarea
                            id={`afterparty-admin-note-${order.id}`}
                            value={reviewNotes[order.id] ?? ''}
                            onChange={(event) =>
                              setReviewNotes((prev) => ({
                                ...prev,
                                [order.id]: event.target.value,
                              }))
                            }
                            placeholder="Volitelné, např. upraven počet podle účtenky"
                          />
                        </label>

                        <div className="homepage-afterparty-admin-total">
                          <span>
                            Body po kontrole: <strong>{previewPoints}</strong>
                          </span>
                          <span>
                            Aktuálně uloženo: <strong>{order.total_points}</strong>
                          </span>
                        </div>

                        <div className="homepage-afterparty-admin-actions">
                          <button
                            type="button"
                            className="homepage-afterparty-inline-button"
                            onClick={() => reviewOrder(order, 'reject')}
                            disabled={isSaving}
                          >
                            {isSaving ? 'Ukládám…' : 'Zamítnout'}
                          </button>
                          <button
                            type="button"
                            className="homepage-afterparty-add-order"
                            onClick={() => reviewOrder(order, 'approve')}
                            disabled={isSaving}
                          >
                            {isSaving ? 'Ukládám…' : 'Potvrdit body'}
                          </button>
                        </div>
                      </article>
                    );
                  })}
                </div>
              ) : null}
            </section>

            {reviewedOrders.length > 0 ? (
              <section className="homepage-afterparty-section">
                <div className="homepage-afterparty-section-head">
                  <h3>Historie</h3>
                </div>
                <div className="homepage-afterparty-admin-list">
                  {reviewedOrders.map((order) => {
                    const participant = order.afterparty_participants ?? null;
                    const items = order.afterparty_order_items ?? [];

                    return (
                      <article
                        key={order.id}
                        className={`homepage-afterparty-admin-order homepage-afterparty-admin-order--history is-${order.status}`}
                      >
                        <div className="homepage-afterparty-admin-order-head">
                          <div>
                            <h3>{participant?.display_name ?? 'Neznámý účastník'}</h3>
                            <p>
                              {participant?.troop_name ?? 'Bez oddílu'} · {formatAfterpartyDate(order.submitted_at)}
                            </p>
                          </div>
                          <span className={`homepage-afterparty-admin-status is-${order.status}`}>
                            {formatAfterpartyStatus(order.status)}
                          </span>
                        </div>

                        <div className="homepage-afterparty-admin-receipt">
                          {renderAdminReceipt(order)}
                        </div>

                        <div className="homepage-afterparty-admin-history-items">
                          {items.map((item) => (
                            <span key={item.id}>
                              <strong>{item.label}</strong>
                              <small>
                                nahlášeno {item.quantity} · uznáno {item.approved_quantity} · {item.points_total} bodů
                              </small>
                            </span>
                          ))}
                        </div>

                        {order.review_note ? (
                          <p className="homepage-afterparty-admin-history-note">{order.review_note}</p>
                        ) : null}

                        <div className="homepage-afterparty-admin-total">
                          <span>
                            Uloženo: <strong>{order.total_points} bodů</strong>
                          </span>
                          {order.reviewed_at ? (
                            <span>
                              Zkontrolováno: <strong>{formatAfterpartyDate(order.reviewed_at)}</strong>
                            </span>
                          ) : null}
                        </div>
                      </article>
                    );
                  })}
                </div>
              </section>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
}

function SiteHeader({
  activeSection,
  title,
  subtitle,
  lead,
}: {
  activeSection?: string;
  title?: string;
  subtitle?: string;
  lead?: string;
}) {
  const [navOpen, setNavOpen] = useState(false);
  const [secretMenuOpen, setSecretMenuOpen] = useState(false);
  const [isDesktopViewport, setIsDesktopViewport] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia('(min-width: 901px)').matches : true,
  );
  const [isDesktopCompact, setIsDesktopCompact] = useState(false);
  const titleTapTimestampsRef = useRef<number[]>([]);
  const navPanelId = 'homepage-nav-panel';
  const useCompactNav = !isDesktopViewport || isDesktopCompact;
  const isNavPanelOpen = useCompactNav ? navOpen : true;
  const resolvedTitle = title ?? 'SPTO a Zelená liga';
  const resolvedSubtitle = subtitle ?? HEADER_SUBTITLE;

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    const mediaQuery = window.matchMedia('(min-width: 901px)');
    const handleViewportChange = (event: MediaQueryListEvent) => {
      setIsDesktopViewport(event.matches);
    };
    setIsDesktopViewport(mediaQuery.matches);
    mediaQuery.addEventListener('change', handleViewportChange);
    return () => {
      mediaQuery.removeEventListener('change', handleViewportChange);
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined' || !isDesktopViewport) {
      setIsDesktopCompact(false);
      return;
    }
    const handleScroll = () => {
      setIsDesktopCompact(window.scrollY > 140);
    };
    handleScroll();
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', handleScroll);
    };
  }, [isDesktopViewport]);

  useEffect(() => {
    if (!useCompactNav) {
      setNavOpen(false);
    }
  }, [useCompactNav]);

  const handleNavToggle = () => {
    setNavOpen((prev) => !prev);
  };
  const handleNavLinkClick = () => {
    if (useCompactNav) {
      setNavOpen(false);
    }
  };

  const handleHeaderTitleClick = () => {
    const now = Date.now();
    const recent = titleTapTimestampsRef.current.filter((timestamp) => now - timestamp <= AFTERPARTY_TRIGGER_WINDOW_MS);
    recent.push(now);
    titleTapTimestampsRef.current = recent;
    if (recent.length >= AFTERPARTY_TRIGGER_CLICK_COUNT) {
      titleTapTimestampsRef.current = [];
      setSecretMenuOpen(true);
    }
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
            <h1 onClick={handleHeaderTitleClick}>{resolvedTitle}</h1>
            <p className="homepage-subtitle">{resolvedSubtitle}</p>
            {lead ? <p className="homepage-lead homepage-hero-lead">{lead}</p> : null}
          </div>
        </div>
      </header>

      <nav
        className={`homepage-nav${useCompactNav ? ' is-compact' : ''}${isDesktopCompact ? ' is-desktop-compact' : ''}`}
        aria-label="Hlavní navigace"
      >
        <div className="homepage-nav-bar">
          <span className="homepage-nav-title">Navigace</span>
          <button
            className={`homepage-nav-toggle${isNavPanelOpen ? ' is-open' : ''}`}
            type="button"
            aria-expanded={isNavPanelOpen}
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
        <div className={`homepage-nav-panel${isNavPanelOpen ? ' is-open' : ''}`} id={navPanelId}>
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
      <SecretMenuGame open={secretMenuOpen} onClose={() => setSecretMenuOpen(false)} />
    </>
  );
}

function SiteShell({
  children,
  activeSection,
  headerTitle,
  headerSubtitle,
  headerLead,
}: {
  children: React.ReactNode;
  activeSection?: string;
  headerTitle?: string;
  headerSubtitle?: string;
  headerLead?: string;
}) {
  const [afterpartyAdminOpen, setAfterpartyAdminOpen] = useState(false);
  const resolvedActiveSection =
    activeSection ?? (typeof window !== 'undefined' ? resolveActiveNav(window.location.pathname) : undefined);
  return (
    <div className="homepage-shell" style={{ scrollBehavior: 'smooth' }}>
      <SiteHeader
        activeSection={resolvedActiveSection}
        title={headerTitle}
        subtitle={headerSubtitle}
        lead={headerLead}
      />
      {children}
      <AppFooter className="homepage-footer" onSecretTrigger={() => setAfterpartyAdminOpen(true)} />
      <AfterpartyAdminManager open={afterpartyAdminOpen} onClose={() => setAfterpartyAdminOpen(false)} />
    </div>
  );
}

function HomepageCarousel({ images }: { images: CarouselImage[] }) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [isPaused, setIsPaused] = useState(false);

  const getPreviousIndex = useCallback((index: number) => (index - 1 + images.length) % images.length, [images.length]);
  const getNextIndex = useCallback((index: number) => (index + 1) % images.length, [images.length]);

  const visibleIndexes = useMemo(() => {
    if (images.length <= 3) {
      return images.map((_, index) => index);
    }
    return Array.from(new Set([getPreviousIndex(activeIndex), activeIndex, getNextIndex(activeIndex)]));
  }, [activeIndex, getNextIndex, getPreviousIndex, images]);

  useEffect(() => {
    if (images.length <= 1 || isPaused) {
      return;
    }
    const timer = window.setInterval(() => {
      setActiveIndex((prev) => getNextIndex(prev));
    }, 7000);
    return () => window.clearInterval(timer);
  }, [getNextIndex, images.length, isPaused]);

  useEffect(() => {
    if (activeIndex >= images.length) {
      setActiveIndex(0);
    }
  }, [activeIndex, images.length]);

  useEffect(() => {
    if (typeof window === 'undefined' || images.length <= 1) {
      return undefined;
    }
    const timer = window.setTimeout(() => {
      [getNextIndex(activeIndex), getPreviousIndex(activeIndex)].forEach((index) => {
        const src = images[index]?.src;
        if (!src) {
          return;
        }
        const image = new Image();
        image.decoding = 'async';
        image.src = src;
      });
    }, 500);
    return () => window.clearTimeout(timer);
  }, [activeIndex, getNextIndex, getPreviousIndex, images]);

  const handlePrev = () => {
    setActiveIndex((prev) => getPreviousIndex(prev));
  };
  const handleNext = () => {
    setActiveIndex((prev) => getNextIndex(prev));
  };

  const getSlidePositionClass = (index: number) => {
    if (index === activeIndex) {
      return 'is-active';
    }
    if (images.length > 1 && index === getPreviousIndex(activeIndex)) {
      return 'is-before';
    }
    if (images.length > 1 && index === getNextIndex(activeIndex)) {
      return 'is-after';
    }
    return 'is-hidden';
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
        onFocus={() => setIsPaused(true)}
        onBlur={() => setIsPaused(false)}
      >
        <div className="homepage-carousel-track">
          {visibleIndexes.map((index) => {
            const image = images[index];
            if (!image) {
              return null;
            }
            const isActive = index === activeIndex;
            return (
              <figure key={image.id} className={`homepage-carousel-slide ${getSlidePositionClass(index)}`}>
                <img
                  src={image.src}
                  alt={image.alt}
                  loading={isActive ? 'eager' : 'lazy'}
                  decoding="async"
                  fetchPriority={isActive ? 'high' : 'low'}
                  width={1600}
                  height={900}
                  sizes="(max-width: 900px) 100vw, 1120px"
                />
              </figure>
            );
          })}
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
  leagueSeason,
}: {
  homepageContent: SanityHomepage | null;
  articles: Article[];
  articlesLoading: boolean;
  leagueSeason: LeagueSeason;
}) {
  const headerTitle = homepageContent?.heroTitle ?? undefined;
  const headerSubtitle = homepageContent?.heroSubtitle ?? undefined;
  const headerLead = HEADER_LEAD;
  const homepageArticles = articles.slice(0, HOMEPAGE_ARTICLE_LIMIT);

  return (
    <SiteShell
      headerTitle={headerTitle ?? undefined}
      headerSubtitle={headerSubtitle ?? undefined}
      headerLead={headerLead}
    >
      <main className="homepage-main" aria-labelledby="homepage-intro-heading">
        <HomepageCarousel images={HOMEPAGE_CAROUSEL} />
        <section className="homepage-section" aria-labelledby="homepage-intro-heading">
          <div className="homepage-section-header homepage-section-header--left">
            <h2 id="homepage-intro-heading">O SPTO a Zelené lize</h2>
            <span className="homepage-section-accent" aria-hidden="true" />
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
          <div className="homepage-section-header homepage-section-header--left">
            <h2 id="clanky-heading">Články a novinky</h2>
            <span className="homepage-section-accent" aria-hidden="true" />
          </div>
          {articlesLoading ? (
            <>
              <p className="homepage-skeleton-status" role="status">
                Načítám články z redakce…
              </p>
              <ArticleSkeletonGrid count={HOMEPAGE_ARTICLE_LIMIT} />
            </>
          ) : homepageArticles.length > 0 ? (
            <div className="homepage-article-grid homepage-article-grid--homepage">
              {homepageArticles.map((article, index) => {
                const isPriorityImage = index < 2;
                const coverUrl = article.coverImage?.url
                  ? getArticleThumbUrl(article.coverImage.url, 360)
                  : '';
                const coverSrcSet = article.coverImage?.url
                  ? buildArticleSrcSet(article.coverImage.url, [180, 240, 360, 480])
                  : '';
                const excerpt = article.excerpt.trim();
                return (
                  <article key={article.title} className="homepage-article-card homepage-article-card--homepage">
                    <div className="homepage-article-row">
                      <div className={`homepage-article-thumb${article.coverImage?.url ? '' : ' is-empty'}`}>
                        {article.coverImage?.url ? (
                          <img
                            src={coverUrl}
                            srcSet={coverSrcSet || undefined}
                            sizes="(max-width: 680px) calc(100vw - 72px), (max-width: 1180px) 128px, 260px"
                            width={320}
                            height={200}
                            alt={article.coverImage.alt ?? article.title}
                            loading="lazy"
                            decoding="async"
                            fetchPriority={isPriorityImage ? 'auto' : 'low'}
                            onError={(event) =>
                              fallbackToOriginalArticleImage(event, article.coverImage?.url ?? '')
                            }
                          />
                        ) : (
                          <span aria-hidden="true">SPTO</span>
                        )}
                      </div>
                      <div className="homepage-article-body">
                        <div className="homepage-article-meta">
                          <time className="homepage-article-date" dateTime={article.dateISO}>
                            {article.dateLabel}
                          </time>
                        </div>
                        <h3 className="homepage-article-title">
                          {article.title}
                        </h3>
                        {excerpt ? (
                          <p className="homepage-article-excerpt homepage-article-excerpt--short">
                            {excerpt}
                          </p>
                        ) : null}
                        <a className="homepage-inline-link homepage-article-read-link" href={article.href}>
                          Číst článek <span aria-hidden="true">→</span>
                        </a>
                      </div>
                    </div>
                  </article>
                );
              })}
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
          <div className="homepage-section-header homepage-section-header--left">
            <h2 id="zelenaliga-heading">Aktuální pořadí</h2>
            <span className="homepage-section-accent" aria-hidden="true" />
          </div>
          <div className="homepage-card" style={{ maxWidth: '880px' }}>
            <h3>Top {LEAGUE_TOP_COUNT} oddílů</h3>
            <p className="homepage-league-note">{leagueSeason.name}</p>
            <ol className="homepage-about-list">
              {addCompetitionRanks(buildLeagueRows(leagueSeason.scores, leagueSeason.troops, leagueSeason.events))
                .slice(0, LEAGUE_TOP_COUNT)
                .map((row) => (
                  <li
                    key={row.key} // Added padding and bottom border for better readability
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '32px 2fr 1fr',
                      gap: '16px',
                      alignItems: 'center',
                      padding: '12px 0',
                      borderBottom: '1px solid rgba(4, 55, 44, 0.1)',
                    }}
                  >
                    <span style={{ textAlign: 'right', fontSize: '1.1rem' }}>{row.rank}.</span>
                    <strong style={{ fontSize: '1.1rem' }}>{row.name}</strong>
                    <span
                      style={{ fontSize: '1.1rem', fontWeight: 600, color: '#0b8e3f', justifySelf: 'end' }}
                    >
                      {row.total === null ? '— bodů' : `${formatLeagueScore(row.total)} bodů`}
                    </span>
                  </li>
                ))}
            </ol>
          </div>
          <div className="homepage-section-cta">
            <a className="homepage-cta secondary" href="/aktualni-poradi">
              Zobrazit celé pořadí
            </a>
          </div>
        </section>

        <section className="homepage-section" id="o-spto" aria-labelledby="o-spto-heading">
          <div className="homepage-section-header homepage-section-header--left">
            <h2 id="o-spto-heading">Z historie</h2>
            <span className="homepage-section-accent" aria-hidden="true" />
          </div>
          <div className="homepage-card" style={{ maxWidth: '880px' }}>
            <ul className="homepage-about-list">
              {SPTO_HISTORY_HIGHLIGHTS.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
          <div className="homepage-section-cta">
            <a className="homepage-cta secondary" href="/o-spto">
              Více o SPTO
            </a>
          </div>
        </section>
      </main>
    </SiteShell>
  );
}

function parseScheduleDate(value: string) {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function formatScheduleDate(event: ScheduleEvent) {
  const formatter = new Intl.DateTimeFormat('cs-CZ', { day: 'numeric', month: 'long', year: 'numeric' });
  const start = parseScheduleDate(event.start);
  if (!event.end) return formatter.format(start);
  const end = parseScheduleDate(event.end);
  if (start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear()) {
    return `${start.getDate()}.–${formatter.format(end)}`;
  }
  return `${formatter.format(start)} – ${formatter.format(end)}`;
}

function eventOccursOn(event: ScheduleEvent, date: Date) {
  const timestamp = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  return timestamp >= parseScheduleDate(event.start).getTime()
    && timestamp <= parseScheduleDate(event.end ?? event.start).getTime();
}

function scheduleDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function ScheduleMonth({
  year,
  month,
  selectedDate,
  onSelectDate,
}: {
  year: number;
  month: number;
  selectedDate: string | null;
  onSelectDate: (date: string) => void;
}) {
  const firstDay = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const leadingDays = (firstDay.getDay() + 6) % 7;
  const cells = Array.from({ length: leadingDays + daysInMonth }, (_, index) => {
    const day = index - leadingDays + 1;
    return day > 0 ? new Date(year, month, day) : null;
  });
  const monthName = new Intl.DateTimeFormat('cs-CZ', { month: 'long', year: 'numeric' }).format(firstDay);

  return (
    <section className="schedule-month" aria-label={monthName}>
      <h3>{monthName}</h3>
      <div className="schedule-weekdays" aria-hidden="true">
        {['Po', 'Út', 'St', 'Čt', 'Pá', 'So', 'Ne'].map((day) => <span key={day}>{day}</span>)}
      </div>
      <div className="schedule-days">
        {cells.map((date, index) => {
          if (!date) return <span className="schedule-day schedule-day--empty" key={`empty-${index}`} aria-hidden="true" />;
          const events = SCHOOL_YEAR_EVENTS.filter((event) => eventOccursOn(event, date));
          const dateKey = scheduleDateKey(date);
          const content = (
            <>
              <span className="schedule-day-number">{date.getDate()}</span>
              {events.map((event) => (
                <span className={`schedule-calendar-event schedule-calendar-event--${event.kind}`} key={`${event.name}-${event.start}`}>
                  {event.name}
                </span>
              ))}
            </>
          );
          return events.length > 0 ? (
            <button
              type="button"
              className={`schedule-day schedule-day--active schedule-day--button${selectedDate === dateKey ? ' is-selected' : ''}`}
              key={dateKey}
              onClick={() => onSelectDate(dateKey)}
              aria-label={`${date.getDate()}. ${monthName}: ${events.map((event) => event.name).join(', ')}`}
              aria-pressed={selectedDate === dateKey}
            >
              {content}
            </button>
          ) : (
            <div className="schedule-day" key={dateKey}>{content}</div>
          );
        })}
      </div>
    </section>
  );
}

function SchedulePage() {
  const [selectedMonthIndex, setSelectedMonthIndex] = useState(0);
  const [selectedCalendarDate, setSelectedCalendarDate] = useState<string | null>(null);
  const months = Array.from({ length: 10 }, (_, index) => {
    const date = new Date(2026, 8 + index, 1);
    return {
      year: date.getFullYear(),
      month: date.getMonth(),
      label: new Intl.DateTimeFormat('cs-CZ', { month: 'long' }).format(date),
    };
  });
  const selectedMonth = months[selectedMonthIndex];
  const selectedCalendarEvents = selectedCalendarDate
    ? SCHOOL_YEAR_EVENTS.filter((event) => eventOccursOn(event, parseScheduleDate(selectedCalendarDate)))
    : [];
  const changeMonth = (nextIndex: number) => {
    setSelectedMonthIndex(nextIndex);
    setSelectedCalendarDate(null);
  };

  return (
    <SiteShell>
      <main className="homepage-main homepage-single schedule-page" aria-labelledby="schedule-heading">
        <div className="schedule-intro">
          <span className="schedule-eyebrow">Školní rok 2026/2027</span>
          <h1 id="schedule-heading">Kalendář SPTO</h1>
          <p className="homepage-lead">Přehled akcí Zelené ligy, sněmů a štábů od září 2026 do června 2027.</p>
        </div>

        <div className="schedule-legend" aria-label="Legenda kalendáře">
          {(Object.keys(SCHEDULE_KIND_LABELS) as ScheduleEventKind[]).map((kind) => (
            <span className={`schedule-legend-item schedule-legend-item--${kind}`} key={kind}>{SCHEDULE_KIND_LABELS[kind]}</span>
          ))}
        </div>

        <section className="homepage-card schedule-overview" aria-labelledby="schedule-list-heading">
          <div className="homepage-section-header homepage-section-header--left">
            <h2 id="schedule-list-heading">Nejbližší termíny</h2>
            <span className="homepage-section-accent" aria-hidden="true" />
          </div>
          <ol className="schedule-list">
            {SCHOOL_YEAR_EVENTS.map((event) => (
              <li className={`schedule-list-item schedule-list-item--${event.kind}`} key={`${event.name}-${event.start}`}>
                <time dateTime={event.start} className="schedule-list-date">{formatScheduleDate(event)}</time>
                <div className="schedule-list-copy">
                  <span className="schedule-list-kind">{SCHEDULE_KIND_LABELS[event.kind]}</span>
                  {event.href ? (
                    <a className="schedule-event-link" href={event.href}>{event.name}</a>
                  ) : (
                    <strong>{event.name}</strong>
                  )}
                  {event.note ? <small>{event.note}</small> : null}
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section className="schedule-calendar-section" aria-labelledby="schedule-calendar-heading">
          <div className="homepage-section-header homepage-section-header--left">
            <h2 id="schedule-calendar-heading">Kalendář školního roku</h2>
            <span className="homepage-section-accent" aria-hidden="true" />
          </div>
          <div className="schedule-calendar-browser">
            <div className="schedule-calendar-controls">
              <button
                type="button"
                className="schedule-calendar-button"
                onClick={() => changeMonth(selectedMonthIndex - 1)}
                disabled={selectedMonthIndex === 0}
                aria-label="Předchozí měsíc"
              >
                <span aria-hidden="true">←</span> Předchozí
              </button>
              <label className="schedule-month-select-label">
                <span className="schedule-visually-hidden">Vyber měsíc</span>
                <select
                  className="schedule-month-select"
                  value={selectedMonthIndex}
                  onChange={(event) => changeMonth(Number(event.target.value))}
                >
                  {months.map((month, index) => (
                    <option value={index} key={`${month.year}-${month.month}`}>
                      {month.label} {month.year}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="schedule-calendar-button"
                onClick={() => changeMonth(selectedMonthIndex + 1)}
                disabled={selectedMonthIndex === months.length - 1}
                aria-label="Následující měsíc"
              >
                Další <span aria-hidden="true">→</span>
              </button>
            </div>
            <div className="schedule-calendar-stage" aria-live="polite">
              <ScheduleMonth
                year={selectedMonth.year}
                month={selectedMonth.month}
                selectedDate={selectedCalendarDate}
                onSelectDate={setSelectedCalendarDate}
              />
            </div>
            {selectedCalendarEvents.length > 0 ? (
              <div className="schedule-selected-events" aria-live="polite">
                {selectedCalendarEvents.map((event) => (
                  <article className={`schedule-selected-event schedule-selected-event--${event.kind}`} key={`${event.name}-${event.start}`}>
                    <span className="schedule-list-kind">{SCHEDULE_KIND_LABELS[event.kind]}</span>
                    <strong>{event.name}</strong>
                    <time dateTime={event.start}>{formatScheduleDate(event)}</time>
                    {event.note ? <small>{event.note}</small> : null}
                    {event.href ? <a className="schedule-event-link" href={event.href}>Detail soutěže →</a> : null}
                  </article>
                ))}
              </div>
            ) : null}
            <div className="schedule-month-dots" aria-label="Rychlý výběr měsíce">
              {months.map((month, index) => (
                <button
                  type="button"
                  key={`${month.year}-${month.month}`}
                  className={`schedule-month-dot${index === selectedMonthIndex ? ' is-active' : ''}`}
                  onClick={() => changeMonth(index)}
                  aria-label={`${month.label} ${month.year}`}
                  aria-current={index === selectedMonthIndex ? 'true' : undefined}
                />
              ))}
            </div>
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
        <h1 id="competitions-heading">Soutěže SPTO</h1>
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
      </main>
    </SiteShell>
  );
}

function ApplicationsPage() {
  return (
    <SiteShell>
      <main className="homepage-main homepage-single" aria-labelledby="apps-heading">
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

function LeagueStandingsPage({ leagueData }: { leagueData: LeagueData }) {
  const [selectedSeasonId, setSelectedSeasonId] = useState(leagueData.activeSeasonId);
  useEffect(() => {
    setSelectedSeasonId((current) =>
      leagueData.seasons.some((season) => season.id === current) ? current : leagueData.activeSeasonId,
    );
  }, [leagueData]);
  const selectedSeason =
    leagueData.seasons.find((season) => season.id === selectedSeasonId) ??
    getActiveLeagueSeason(leagueData);
  const leagueGridTemplate = `minmax(220px, 1.3fr) repeat(${selectedSeason.events.length}, minmax(90px, 1fr)) minmax(90px, 0.8fr)`;
  const rows = addCompetitionRanks(buildLeagueRows(selectedSeason.scores, selectedSeason.troops, selectedSeason.events));
  const hasAnyScores = rows.some((row) => row.total !== null);

  return (
    <SiteShell>
      <main className="homepage-main homepage-single homepage-league-page" aria-labelledby="league-heading">
        <h1 id="league-heading">Pořadí Zelené ligy</h1>
        <div className="gallery-year-tabs homepage-league-season-tabs" aria-label="Ročníky pořadí">
          {leagueData.seasons.map((season) => (
            <button
              key={season.id}
              type="button"
              className={`gallery-year-tab${season.id === selectedSeason.id ? ' is-active' : ''}`}
              onClick={() => setSelectedSeasonId(season.id)}
            >
              {season.name}
              {season.isActive ? ' · aktuální' : ''}
            </button>
          ))}
        </div>
        <div className="homepage-card homepage-league-table-card">
          <div className="homepage-league-season-heading">
            <h2>{selectedSeason.name}</h2>
            {selectedSeason.isActive ? <span>Aktuální ročník</span> : <span>Archivní ročník</span>}
          </div>
          {!hasAnyScores ? (
            <p className="homepage-league-note">Body pro tento ročník zatím nejsou vyplněné.</p>
          ) : null}
          <div className="homepage-league-table" style={{ '--league-grid': leagueGridTemplate } as React.CSSProperties}>
            <div className="homepage-league-row homepage-league-header">
              <span>Oddíl</span>
              {selectedSeason.events.map((event) => (
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
                  const event = selectedSeason.events[scoreIndex];
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
          <h2>Historická tabulka</h2>
          {HISTORICAL_LEAGUE_EMBED_URL ? (
            <>
              <div className="homepage-league-embed">
                <iframe
                  src={HISTORICAL_LEAGUE_EMBED_URL}
                  title="Historické pořadí Zelené ligy"
                  loading="lazy"
                  allowFullScreen
                />
              </div>
              <div className="homepage-league-embed-actions">
                <a className="homepage-inline-link" href={HISTORICAL_LEAGUE_VIEW_URL} target="_blank" rel="noreferrer">
                  Otevřít historickou tabulku samostatně
                </a>
              </div>
            </>
          ) : (
            <p>Sem vložíme Google tabulku s historickým pořadím. Pošli prosím embed link.</p>
          )}
        </div>
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
        <h1 id="about-spto-heading">O SPTO</h1>

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
      </main>
    </SiteShell>
  );
}

export default function ZelenaligaSite() {
  const [homepageContent, setHomepageContent] = useState<SanityHomepage | null>(null);
  const [articles, setArticles] = useState<Article[]>([]);
  const [articlesLoading, setArticlesLoading] = useState(false);
  const [articlesHasMore, setArticlesHasMore] = useState(false);
  const [articlesLoadingMore, setArticlesLoadingMore] = useState(false);
  const [leagueData, setLeagueData] = useState<LeagueData>(createDefaultLeagueData());
  const [driveAlbums, setDriveAlbums] = useState<DriveAlbum[]>([]);
  const [galleryYears, setGalleryYears] = useState<string[]>([]);
  const [galleryAlbumCountsByYear, setGalleryAlbumCountsByYear] = useState<Record<string, number>>({});
  const [selectedGalleryYear, setSelectedGalleryYear] = useState<string | null>(null);
  const [driveAlbumsLoading, setDriveAlbumsLoading] = useState(false);
  const path = window.location.pathname.replace(/\/$/, '') || '/';
  const segments = path.split('/').filter(Boolean);
  const slug = segments[0] ?? '';
  const shouldLoadArticles = path === '/' || path === '/clanky';
  const shouldLoadLeague = path === '/' || slug === 'aktualni-poradi' || slug === 'zelena-liga';
  const shouldLoadGallery = slug === 'fotogalerie';
  const isGalleryOverviewRoute = shouldLoadGallery && segments.length === 1;

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
    if (!shouldLoadArticles) {
      setArticles([]);
      setArticlesHasMore(false);
      setArticlesLoading(false);
      return;
    }
    let active = true;
    const limit = path === '/' ? HOMEPAGE_ARTICLE_LIMIT : ARTICLES_PAGE_SIZE;
    setArticles([]);
    setArticlesHasMore(false);
    setArticlesLoading(true);
    fetchContentArticles({ limit })
      .then((pageData) => {
        if (!active) {
          return;
        }
        setArticles(pageData.articles.map(mapContentArticle));
        setArticlesHasMore(path === '/clanky' && pageData.hasMore);
      })
      .catch(() => {
        if (active) {
          setArticles([]);
          setArticlesHasMore(false);
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
  }, [path, shouldLoadArticles]);

  const handleLoadMoreArticles = () => {
    if (path !== '/clanky' || articlesLoading || articlesLoadingMore || !articlesHasMore) {
      return;
    }
    setArticlesLoadingMore(true);
    fetchContentArticles({ limit: ARTICLES_PAGE_SIZE, offset: articles.length })
      .then((pageData) => {
        setArticles((current) => {
          const existingHrefs = new Set(current.map((article) => article.href));
          const nextArticles = pageData.articles
            .map(mapContentArticle)
            .filter((article) => !existingHrefs.has(article.href));
          return [...current, ...nextArticles];
        });
        setArticlesHasMore(pageData.hasMore);
      })
      .catch(() => {
        // Keep the button available so the visitor can retry the same page.
      })
      .finally(() => {
        setArticlesLoadingMore(false);
      });
  };

  useEffect(() => {
    if (!shouldLoadLeague) {
      return;
    }
    let active = true;
    fetch('/api/content/league')
      .then((response) => (response.ok ? response.json() : Promise.reject()))
      .then((data) => {
        if (!active) {
          return;
        }
        setLeagueData(normalizeLeagueData(data));
      })
      .catch(() => {
        if (active) {
          setLeagueData(createDefaultLeagueData());
        }
      });
    return () => {
      active = false;
    };
  }, [shouldLoadLeague]);

  useEffect(() => {
    if (!isGalleryOverviewRoute) {
      setGalleryYears([]);
      setGalleryAlbumCountsByYear({});
      setSelectedGalleryYear(null);
      return;
    }
    let active = true;
    setDriveAlbumsLoading(true);
    fetch('/api/gallery?years=1')
      .then((response) => (response.ok ? response.json() : Promise.reject()))
      .then((data) => {
        if (!active) {
          return;
        }
        const albumCountsByYear: Record<string, number> = {};
        if (data.albumCountsByYear && typeof data.albumCountsByYear === 'object' && !Array.isArray(data.albumCountsByYear)) {
          Object.entries(data.albumCountsByYear as Record<string, unknown>).forEach(([yearKey, value]) => {
            const parsed = Number(value);
            if (yearKey.trim().length === 0 || !Number.isFinite(parsed) || parsed < 0) {
              return;
            }
            albumCountsByYear[yearKey] = Math.round(parsed);
          });
        }
        const years = Array.isArray(data.years)
          ? data.years.filter((value: unknown): value is string => typeof value === 'string' && value.trim().length > 0)
          : [];
        setGalleryAlbumCountsByYear(albumCountsByYear);
        setGalleryYears(years);
        setSelectedGalleryYear((current) => (current && years.includes(current) ? current : years[0] ?? null));
        if (years.length === 0) {
          setDriveAlbums([]);
          setDriveAlbumsLoading(false);
        }
      })
      .catch(() => {
        if (active) {
          setGalleryYears([]);
          setGalleryAlbumCountsByYear({});
          setSelectedGalleryYear(null);
          setDriveAlbums([]);
          setDriveAlbumsLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [isGalleryOverviewRoute]);

  useEffect(() => {
    if (!shouldLoadGallery) {
      setDriveAlbumsLoading(false);
      return;
    }
    const endpoint = isGalleryOverviewRoute
      ? selectedGalleryYear
        ? `/api/gallery?year=${encodeURIComponent(selectedGalleryYear)}`
        : ''
      : '/api/gallery';
    if (!endpoint) {
      setDriveAlbums([]);
      return;
    }
    let active = true;
    setDriveAlbumsLoading(true);
    fetch(endpoint)
      .then(async (response) => {
        if (!response.ok) {
          throw new Error('Failed to load albums.');
        }
        return response.json();
      })
      .then((data) => {
        if (active) {
          const albums = data.albums ?? [];
          setDriveAlbums(albums);
          if (isGalleryOverviewRoute && selectedGalleryYear) {
            setGalleryAlbumCountsByYear((current) => {
              if (current[selectedGalleryYear] === albums.length) {
                return current;
              }
              return {
                ...current,
                [selectedGalleryYear]: albums.length,
              };
            });
          }
          // Data will be loaded on-demand when user navigates to gallery
          // Cache keeps data in memory for 5 minutes (see galleryCache.ts)
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
  }, [isGalleryOverviewRoute, selectedGalleryYear, shouldLoadGallery]);

  useEffect(() => {
    if (path !== '/') {
      return;
    }
    let active = true;
    const prefetchTimers: number[] = [];
    let startTimer: number | null = null;
    let idleCallbackId: number | null = null;
    const browserWindow = window as Window & {
      requestIdleCallback?: (callback: IdleRequestCallback, options?: IdleRequestOptions) => number;
      cancelIdleCallback?: (handle: number) => void;
    };

    const startPrefetch = () => {
      fetch(`/api/gallery?limit=${HOMEPAGE_GALLERY_PREFETCH_LIMIT}`)
        .then((response) => (response.ok ? response.json() : Promise.reject()))
        .then((data) => {
          if (!active) {
            return;
          }
          const albums = Array.isArray(data.albums) ? (data.albums as DriveAlbum[]) : [];
          albums
            .slice(0, HOMEPAGE_GALLERY_PREFETCH_LIMIT)
            .forEach((album, index) => {
              if (!album?.folderId) {
                return;
              }
              const timer = window.setTimeout(() => {
                if (!active) {
                  return;
                }
                fetchAlbumPreview(album.folderId).catch(() => undefined);
              }, index * HOMEPAGE_GALLERY_PREFETCH_DELAY_MS);
              prefetchTimers.push(timer);
            });
        })
        .catch(() => undefined);
    };

    const schedulePrefetchAfterLoad = () => {
      if (!active) {
        return;
      }
      if (browserWindow.requestIdleCallback) {
        idleCallbackId = browserWindow.requestIdleCallback(() => {
          startTimer = window.setTimeout(startPrefetch, 200);
        }, { timeout: 2000 });
        return;
      }
      startTimer = window.setTimeout(startPrefetch, 400);
    };

    if (document.readyState === 'complete') {
      schedulePrefetchAfterLoad();
    } else {
      window.addEventListener('load', schedulePrefetchAfterLoad, { once: true });
    }

    return () => {
      active = false;
      window.removeEventListener('load', schedulePrefetchAfterLoad);
      if (startTimer !== null) {
        window.clearTimeout(startTimer);
      }
      if (idleCallbackId !== null && browserWindow.cancelIdleCallback) {
        browserWindow.cancelIdleCallback(idleCallbackId);
      }
      prefetchTimers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [path]);

  if (path === '/') {
    return (
      <Homepage
        homepageContent={homepageContent}
        articles={articles}
        articlesLoading={articlesLoading}
        leagueSeason={getActiveLeagueSeason(leagueData)}
      />
    );
  }

  if (segments.length > 0) {
    const slug = segments[0];
    if (slug === 'redakce') {
      return <RedakcePage />;
    }
    if (slug === 'plan-akci' && segments.length === 1) {
      return <SchedulePage />;
    }
    if (slug === 'souteze') {
      if (segments.length > 1) {
        return <CompetitionRulesPage slug={segments[1]} />;
      }
      return <CompetitionsPage />;
    }

    if (slug === 'aktualni-poradi' || slug === 'zelena-liga') {
      return <LeagueStandingsPage leagueData={leagueData} />;
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
        return <ArticlePageLoader slug={articleSlug} />;
      }
      return (
        <ArticlesIndexPage
          articles={articles}
          articlesLoading={articlesLoading}
          hasMore={articlesHasMore}
          loadingMore={articlesLoadingMore}
          onLoadMore={handleLoadMoreArticles}
        />
      );
    }

    if (slug === 'fotogalerie') {
      if (segments.length > 1) {
        const albumSlug = segments[segments.length - 1];
        return <GalleryAlbumPage slug={albumSlug} albums={driveAlbums} loading={driveAlbumsLoading} />;
      }
      return (
        <GalleryOverviewPage
          albums={driveAlbums}
          loading={driveAlbumsLoading}
          years={galleryYears}
          selectedYear={selectedGalleryYear}
          loadingSkeletonCount={selectedGalleryYear ? galleryAlbumCountsByYear[selectedGalleryYear] : undefined}
          onSelectYear={setSelectedGalleryYear}
        />
      );
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
          title={readableSlug}
          lead="Obsah stránky připravujeme. Podívej se na hlavní rozcestník."
        />
      );
    }
  }

  return <NotFoundPage />;
}
