import {
  fetchPionyrArticleBySlug,
  fetchPionyrArticles,
  type PionyrArticle,
} from '../api-lib/content/pionyr.js';
import {
  clearEditorSession,
  requireEditor,
  setEditorSession,
  validatePassword,
  verifyEditorSession,
} from '../api-lib/content/editorAuth.js';
import { getSupabaseAdminClient } from '../api-lib/content/supabaseAdmin.js';

type LocalArticleRow = {
  id: string;
  slug: string;
  title: string;
  excerpt: string | null;
  body: string | null;
  author: string | null;
  cover_image_url: string | null;
  cover_image_alt: string | null;
  status: string;
  published_at: string | null;
  created_at: string;
  source?: string | null;
  external_id?: string | null;
  external_url?: string | null;
  synced_at?: string | null;
};

type LocalArticleSummaryRow = Pick<
  LocalArticleRow,
  | 'slug'
  | 'title'
  | 'excerpt'
  | 'author'
  | 'cover_image_url'
  | 'cover_image_alt'
  | 'published_at'
  | 'created_at'
  | 'source'
>;

type ImportedArticleRow = {
  id: string;
  external_id: string | null;
  updated_at: string | null;
  synced_at: string | null;
};

type LeagueScoreRow = {
  season_id?: string | null;
  troop_id: string;
  event_key: string;
  points: number | null;
};

type LeagueSeasonRow = {
  id: string;
  name: string;
  is_active: boolean;
  starts_on?: string | null;
  ends_on?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

type LeagueSeasonTroopRow = {
  season_id: string;
  troop_id: string;
  troop_name: string;
  order_index: number | null;
};

type LeagueSeasonEventRow = {
  season_id: string;
  event_key: string;
  event_label: string;
  event_name: string;
  order_index: number | null;
};

type PublicLeagueSeason = {
  id: string;
  name: string;
  isActive: boolean;
  startsOn?: string | null;
  endsOn?: string | null;
  troops: Array<{ id: string; name: string; order: number }>;
  events: Array<{ key: string; label: string; name: string; order: number }>;
  scores: LeagueScoreRow[];
};

type AlbumTitleRow = {
  folder_id: string;
  title: string;
  created_at?: string | null;
  updated_at?: string | null;
};

type PublicArticle = {
  source: 'pionyr' | 'local';
  slug: string;
  title: string;
  excerpt: string;
  dateISO: string;
  author?: string | null;
  coverImage?: { url: string | null; alt?: string | null } | null;
  body?: string | null;
  bodyFormat?: 'html' | 'text' | null;
};

type SitemapStaticEntry = {
  path: string;
  changefreq?: string;
  priority?: number;
};

type LeagueScoreInput = {
  season_id?: string;
  troop_id: string;
  event_key: string;
  points: number | null;
};

type LeagueSeasonInput = {
  id: string;
  name: string;
  is_active: boolean;
  starts_on?: string | null;
  ends_on?: string | null;
};

type LeagueTroopInput = {
  troop_id: string;
  troop_name: string;
  order_index: number;
};

type LeagueEventInput = {
  event_key: string;
  event_label: string;
  event_name: string;
  order_index: number;
};

type ArticleImageUploadRequest = {
  name: string;
  type: string;
  size?: number;
};

type AfterpartyOrderStatus = 'pending' | 'approved' | 'rejected';

type AfterpartyAdminOrderItem = {
  id: string;
  drink_key: string;
  label: string;
  category: string;
  quantity: number;
  approved_quantity: number;
  points_each: number;
  points_total: number;
};

type AfterpartyAdminOrder = {
  id: string;
  participant_id: string;
  status: AfterpartyOrderStatus;
  receipt_path: string;
  total_points: number;
  review_note: string | null;
  submitted_at: string;
  reviewed_at: string | null;
  receipt_signed_url?: string | null;
  afterparty_participants?: {
    id: string;
    display_name: string;
    troop_name: string;
  } | null;
  afterparty_order_items?: AfterpartyAdminOrderItem[];
};

const AFTERPARTY_RECEIPTS_BUCKET = 'afterparty-receipts';
const CONTENT_ARTICLE_IMAGES_BUCKET = 'content-article-images';
const CONTENT_ARTICLE_ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const PUBLIC_ARTICLE_PAGE_SIZE = 12;
const PUBLIC_ARTICLE_MAX_PAGE_SIZE = 50;
const SITEMAP_BASE_URL = 'https://www.zelenaliga.cz';
const DEFAULT_LEAGUE_SEASON_ID = '2025-2026';
const DEFAULT_LEAGUE_SEASON_NAME = 'Ročník 2025/2026';
const SITEMAP_STATIC_ENTRIES: SitemapStaticEntry[] = [
  { path: '/', changefreq: 'weekly', priority: 1.0 },
  { path: '/souteze', changefreq: 'weekly', priority: 0.8 },
  { path: '/souteze/setonuv-zavod', changefreq: 'monthly', priority: 0.7 },
  { path: '/souteze/draci-smycka', changefreq: 'monthly', priority: 0.7 },
  { path: '/souteze/kosmuv-prostor', changefreq: 'monthly', priority: 0.7 },
  { path: '/souteze/ringobal', changefreq: 'monthly', priority: 0.7 },
  { path: '/souteze/deskove-hry', changefreq: 'monthly', priority: 0.7 },
  { path: '/souteze/brnenske-bloudeni', changefreq: 'monthly', priority: 0.7 },
  { path: '/souteze/piotrio', changefreq: 'monthly', priority: 0.7 },
  { path: '/souteze/karakoram', changefreq: 'monthly', priority: 0.7 },
  { path: '/souteze/lakros', changefreq: 'monthly', priority: 0.7 },
  { path: '/souteze/vybijena', changefreq: 'monthly', priority: 0.7 },
  { path: '/souteze/memorial-bedricha-stolicky', changefreq: 'monthly', priority: 0.7 },
  { path: '/aplikace', changefreq: 'monthly', priority: 0.6 },
  { path: '/aplikace/setonuv-zavod/vysledky', changefreq: 'weekly', priority: 0.5 },
  { path: '/aplikace/deskovky', changefreq: 'weekly', priority: 0.5 },
  { path: '/aplikace/deskovky/standings', changefreq: 'daily', priority: 0.5 },
  { path: '/aplikace/deskovky/pravidla', changefreq: 'monthly', priority: 0.4 },
  { path: '/aktualni-poradi', changefreq: 'weekly', priority: 0.7 },
  { path: '/plan-akci', changefreq: 'monthly', priority: 0.7 },
  { path: '/oddily', changefreq: 'weekly', priority: 0.7 },
  { path: '/fotogalerie', changefreq: 'daily', priority: 0.7 },
  { path: '/clanky', changefreq: 'daily', priority: 0.8 },
  { path: '/o-spto', changefreq: 'monthly', priority: 0.6 },
  { path: '/kontakty', changefreq: 'monthly', priority: 0.6 },
];

function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function resolveBody(req: any): Record<string, unknown> {
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  if (req.body && typeof req.body === 'object') {
    return req.body as Record<string, unknown>;
  }
  return {};
}

function isMissingLeagueSeasonSchemaError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const code = typeof (error as any).code === 'string' ? (error as any).code : '';
  const message = typeof (error as any).message === 'string' ? (error as any).message : '';
  return (
    code === '42P01' ||
    code === '42703' ||
    message.includes('content_league_seasons') ||
    message.includes('content_league_season_troops') ||
    message.includes('content_league_season_events') ||
    message.includes('season_id') ||
    message.includes('schema cache')
  );
}

function parseLeagueSeason(payload: Record<string, unknown>): LeagueSeasonInput {
  const rawSeason = payload.season && typeof payload.season === 'object'
    ? payload.season as Record<string, unknown>
    : payload;
  const rawName = typeof rawSeason.name === 'string' ? rawSeason.name.trim() : '';
  const name = rawName || DEFAULT_LEAGUE_SEASON_NAME;
  const rawId = typeof rawSeason.id === 'string' ? rawSeason.id.trim() : '';
  const id = rawId || slugify(name) || DEFAULT_LEAGUE_SEASON_ID;
  const startsOn = typeof rawSeason.starts_on === 'string' ? rawSeason.starts_on.trim() : null;
  const endsOn = typeof rawSeason.ends_on === 'string' ? rawSeason.ends_on.trim() : null;
  return {
    id,
    name,
    is_active: rawSeason.is_active === true || rawSeason.isActive === true,
    starts_on: startsOn || null,
    ends_on: endsOn || null,
  };
}

function parseLeagueTroops(payload: Record<string, unknown>): LeagueTroopInput[] {
  const raw = Array.isArray(payload.troops) ? payload.troops : [];
  const seen = new Set<string>();
  const parsed: LeagueTroopInput[] = [];
  raw.forEach((entry, index) => {
    if (!entry || typeof entry !== 'object') {
      return;
    }
    const rawId =
      typeof (entry as any).troop_id === 'string'
        ? (entry as any).troop_id
        : typeof (entry as any).id === 'string'
          ? (entry as any).id
          : '';
    const rawName =
      typeof (entry as any).troop_name === 'string'
        ? (entry as any).troop_name
        : typeof (entry as any).name === 'string'
          ? (entry as any).name
          : '';
    const troopName = rawName.trim();
    const troopId = (rawId.trim() || slugify(troopName)).trim();
    if (!troopId || !troopName || seen.has(troopId)) {
      return;
    }
    seen.add(troopId);
    const orderRaw = Number((entry as any).order_index ?? (entry as any).order ?? index);
    parsed.push({
      troop_id: troopId,
      troop_name: troopName,
      order_index: Number.isFinite(orderRaw) ? Math.max(0, Math.round(orderRaw)) : index,
    });
  });
  return parsed.sort((a, b) => a.order_index - b.order_index);
}

function parseLeagueEvents(payload: Record<string, unknown>): LeagueEventInput[] {
  const raw = Array.isArray(payload.events) ? payload.events : [];
  const seen = new Set<string>();
  const parsed: LeagueEventInput[] = [];
  raw.forEach((entry, index) => {
    if (!entry || typeof entry !== 'object') {
      return;
    }
    const rawKey =
      typeof (entry as any).event_key === 'string'
        ? (entry as any).event_key
        : typeof (entry as any).key === 'string'
          ? (entry as any).key
          : '';
    const rawLabel =
      typeof (entry as any).event_label === 'string'
        ? (entry as any).event_label
        : typeof (entry as any).label === 'string'
          ? (entry as any).label
          : '';
    const rawName =
      typeof (entry as any).event_name === 'string'
        ? (entry as any).event_name
        : typeof (entry as any).name === 'string'
          ? (entry as any).name
          : '';
    const eventLabel = rawLabel.trim() || rawName.trim() || rawKey.trim();
    const eventName = rawName.trim() || rawLabel.trim() || rawKey.trim();
    const eventKey = (rawKey.trim() || slugify(eventName)).trim();
    if (!eventKey || !eventLabel || !eventName || seen.has(eventKey)) {
      return;
    }
    seen.add(eventKey);
    const orderRaw = Number((entry as any).order_index ?? (entry as any).order ?? index);
    parsed.push({
      event_key: eventKey,
      event_label: eventLabel,
      event_name: eventName,
      order_index: Number.isFinite(orderRaw) ? Math.max(0, Math.round(orderRaw)) : index,
    });
  });
  return parsed.sort((a, b) => a.order_index - b.order_index);
}

function parseLeagueScores(payload: Record<string, unknown>): LeagueScoreInput[] | null {
  const raw = payload.scores;
  if (!Array.isArray(raw)) {
    return null;
  }
  const season = parseLeagueSeason(payload);
  const parsed: LeagueScoreInput[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }
    const seasonId =
      typeof (entry as any).season_id === 'string' && (entry as any).season_id.trim()
        ? (entry as any).season_id.trim()
        : season.id;
    const troopId = typeof (entry as any).troop_id === 'string' ? (entry as any).troop_id.trim() : '';
    const eventKey = typeof (entry as any).event_key === 'string' ? (entry as any).event_key.trim() : '';
    if (!troopId || !eventKey) {
      continue;
    }
    const pointsRaw = (entry as any).points;
    let points: number | null = null;
    if (pointsRaw === null || pointsRaw === undefined || pointsRaw === '') {
      points = null;
    } else if (typeof pointsRaw === 'number') {
      points = Number.isFinite(pointsRaw) ? pointsRaw : null;
    } else if (typeof pointsRaw === 'string') {
      const normalized = pointsRaw.replace(',', '.').trim();
      const parsedNumber = Number(normalized);
      points = Number.isFinite(parsedNumber) ? parsedNumber : null;
    } else {
      continue;
    }
    parsed.push({ season_id: seasonId, troop_id: troopId, event_key: eventKey, points });
  }
  return parsed.length > 0 ? parsed : null;
}

function buildLeagueSeasonsPayload({
  seasons,
  troops,
  events,
  scores,
}: {
  seasons: LeagueSeasonRow[];
  troops: LeagueSeasonTroopRow[];
  events: LeagueSeasonEventRow[];
  scores: LeagueScoreRow[];
}): { seasons: PublicLeagueSeason[]; activeSeasonId: string; scores: LeagueScoreRow[] } {
  const seasonRows = seasons.length > 0
    ? seasons
    : [{ id: DEFAULT_LEAGUE_SEASON_ID, name: DEFAULT_LEAGUE_SEASON_NAME, is_active: true }];
  const seasonIds = new Set(seasonRows.map((season) => season.id));
  const troopsBySeason = new Map<string, LeagueSeasonTroopRow[]>();
  troops.forEach((troop) => {
    if (!seasonIds.has(troop.season_id)) {
      return;
    }
    const items = troopsBySeason.get(troop.season_id) ?? [];
    items.push(troop);
    troopsBySeason.set(troop.season_id, items);
  });
  const eventsBySeason = new Map<string, LeagueSeasonEventRow[]>();
  events.forEach((event) => {
    if (!seasonIds.has(event.season_id)) {
      return;
    }
    const items = eventsBySeason.get(event.season_id) ?? [];
    items.push(event);
    eventsBySeason.set(event.season_id, items);
  });
  const scoresBySeason = new Map<string, LeagueScoreRow[]>();
  scores.forEach((score) => {
    const seasonId = score.season_id || DEFAULT_LEAGUE_SEASON_ID;
    if (!seasonIds.has(seasonId)) {
      return;
    }
    const items = scoresBySeason.get(seasonId) ?? [];
    items.push({ ...score, season_id: seasonId });
    scoresBySeason.set(seasonId, items);
  });
  const publicSeasons = seasonRows.map((season) => {
    const seasonTroops = (troopsBySeason.get(season.id) ?? [])
      .slice()
      .sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0));
    const seasonEvents = (eventsBySeason.get(season.id) ?? [])
      .slice()
      .sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0));
    return {
      id: season.id,
      name: season.name,
      isActive: season.is_active,
      startsOn: season.starts_on ?? null,
      endsOn: season.ends_on ?? null,
      troops: seasonTroops.map((troop, index) => ({
        id: troop.troop_id,
        name: troop.troop_name,
        order: troop.order_index ?? index,
      })),
      events: seasonEvents.map((event, index) => ({
        key: event.event_key,
        label: event.event_label,
        name: event.event_name,
        order: event.order_index ?? index,
      })),
      scores: scoresBySeason.get(season.id) ?? [],
    };
  });
  const activeSeason = publicSeasons.find((season) => season.isActive) ?? publicSeasons[0];
  return {
    seasons: publicSeasons,
    activeSeasonId: activeSeason?.id ?? DEFAULT_LEAGUE_SEASON_ID,
    scores: activeSeason?.scores ?? [],
  };
}

async function loadLeagueSeasons(supabase: ReturnType<typeof getSupabaseAdminClient>) {
  const [seasonsResult, troopsResult, eventsResult, scoresResult] = await Promise.all([
    supabase
      .from('content_league_seasons')
      .select('id,name,is_active,starts_on,ends_on,created_at,updated_at')
      .order('starts_on', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false }),
    supabase
      .from('content_league_season_troops')
      .select('season_id,troop_id,troop_name,order_index')
      .order('season_id', { ascending: true })
      .order('order_index', { ascending: true }),
    supabase
      .from('content_league_season_events')
      .select('season_id,event_key,event_label,event_name,order_index')
      .order('season_id', { ascending: true })
      .order('order_index', { ascending: true }),
    supabase
      .from('content_league_scores')
      .select('season_id,troop_id,event_key,points'),
  ]);

  if (seasonsResult.error || troopsResult.error || eventsResult.error || scoresResult.error) {
    const error = seasonsResult.error ?? troopsResult.error ?? eventsResult.error ?? scoresResult.error;
    throw error;
  }

  return buildLeagueSeasonsPayload({
    seasons: (seasonsResult.data ?? []) as LeagueSeasonRow[],
    troops: (troopsResult.data ?? []) as LeagueSeasonTroopRow[],
    events: (eventsResult.data ?? []) as LeagueSeasonEventRow[],
    scores: (scoresResult.data ?? []) as LeagueScoreRow[],
  });
}

function parseAlbumTitlePayload(payload: Record<string, unknown>): {
  upserts: Array<{ folder_id: string; title: string }>;
  deletes: string[];
} {
  const items = Array.isArray(payload.items) ? payload.items : [];
  const remove = Array.isArray(payload.remove) ? payload.remove : [];
  const upserts: Array<{ folder_id: string; title: string }> = [];
  const deletes: string[] = [];

  for (const entry of items) {
    if (!entry || typeof entry !== 'object') continue;
    const folderId = typeof (entry as any).folder_id === 'string' ? (entry as any).folder_id.trim() : '';
    if (!folderId) continue;
    const rawTitle = typeof (entry as any).title === 'string' ? (entry as any).title : '';
    const title = rawTitle.trim();
    if (!title) {
      deletes.push(folderId);
      continue;
    }
    upserts.push({ folder_id: folderId, title });
  }

  for (const id of remove) {
    if (typeof id === 'string' && id.trim()) {
      deletes.push(id.trim());
    }
  }

  return {
    upserts,
    deletes: Array.from(new Set(deletes)),
  };
}

function parseNonNegativeInt(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(0, Math.round(value));
  }
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) {
      return Math.max(0, parsed);
    }
  }
  return Math.max(0, Math.round(fallback));
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function normalizeSitemapLastmod(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    return null;
  }
  return new Date(timestamp).toISOString();
}

function renderSitemapUrl(params: { loc: string; lastmod?: string; changefreq?: string; priority?: number }): string {
  const lines = ['  <url>', `    <loc>${escapeXml(params.loc)}</loc>`];
  if (params.lastmod) {
    lines.push(`    <lastmod>${escapeXml(params.lastmod)}</lastmod>`);
  }
  if (params.changefreq) {
    lines.push(`    <changefreq>${params.changefreq}</changefreq>`);
  }
  if (typeof params.priority === 'number') {
    lines.push(`    <priority>${params.priority.toFixed(1)}</priority>`);
  }
  lines.push('  </url>');
  return lines.join('\n');
}

function resolveArticleImageExtension(fileName: string, contentType: string): string {
  const extensionFromName = fileName
    .split('.')
    .pop()
    ?.toLowerCase()
    .replace(/[^a-z0-9]/g, '');
  if (extensionFromName && ['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(extensionFromName)) {
    return extensionFromName === 'jpg' ? 'jpeg' : extensionFromName;
  }
  if (contentType === 'image/png') return 'png';
  if (contentType === 'image/webp') return 'webp';
  if (contentType === 'image/gif') return 'gif';
  return 'jpeg';
}

function parseAfterpartyReviewItems(payload: Record<string, unknown>): Map<string, number> {
  const rawItems = Array.isArray(payload.items) ? payload.items : [];
  const quantities = new Map<string, number>();
  rawItems.forEach((entry) => {
    if (!entry || typeof entry !== 'object') {
      return;
    }
    const id = typeof (entry as any).id === 'string' ? (entry as any).id.trim() : '';
    if (!id) {
      return;
    }
    quantities.set(id, parseNonNegativeInt((entry as any).approved_quantity, 0));
  });
  return quantities;
}

async function loadAfterpartyAdminOrders(supabase: ReturnType<typeof getSupabaseAdminClient>) {
  const { data, error } = await supabase
    .from('afterparty_orders')
    .select(
      'id, participant_id, status, receipt_path, total_points, review_note, submitted_at, reviewed_at, afterparty_participants(id, display_name, troop_name), afterparty_order_items(id, drink_key, label, category, quantity, approved_quantity, points_each, points_total)',
    )
    .order('submitted_at', { ascending: false })
    .limit(200);

  if (error) {
    throw error;
  }

  const statusOrder: Record<AfterpartyOrderStatus, number> = {
    pending: 0,
    approved: 1,
    rejected: 2,
  };

  const orders = ((data ?? []) as unknown as AfterpartyAdminOrder[])
    .map((order) => ({
      ...order,
      afterparty_order_items: [...(order.afterparty_order_items ?? [])].sort(
        (a, b) => a.category.localeCompare(b.category, 'cs') || a.label.localeCompare(b.label, 'cs'),
      ),
    }))
    .sort((a, b) => {
      const statusDiff = statusOrder[a.status] - statusOrder[b.status];
      if (statusDiff !== 0) {
        return statusDiff;
      }
      return new Date(b.submitted_at).getTime() - new Date(a.submitted_at).getTime();
    });

  return Promise.all(
    orders.map(async (order) => {
      if (!order.receipt_path) {
        return { ...order, receipt_signed_url: null };
      }
      const { data: signedUrlData, error: signedUrlError } = await supabase.storage
        .from(AFTERPARTY_RECEIPTS_BUCKET)
        .createSignedUrl(order.receipt_path, 60 * 60);
      if (signedUrlError) {
        console.error('[api/content/afterparty] failed to create signed URL', signedUrlError);
        return { ...order, receipt_signed_url: null };
      }
      return { ...order, receipt_signed_url: signedUrlData?.signedUrl ?? null };
    }),
  );
}

async function handleAdminAfterparty(req: any, res: any, segments: string[]) {
  if (!requireEditor(req, res)) {
    return;
  }

  const supabase = getSupabaseAdminClient();
  const [resource, id] = segments;

  if ((segments.length === 0 || resource === 'orders') && req.method === 'GET') {
    try {
      const orders = await loadAfterpartyAdminOrders(supabase);
      res.status(200).json({ orders });
    } catch (error) {
      console.error('[api/content/admin/afterparty] failed to load orders', error);
      res.status(500).json({ error: 'Failed to load afterparty orders.' });
    }
    return;
  }

  if (resource === 'orders' && id && req.method === 'POST') {
    const payload = resolveBody(req);
    const action = typeof payload.action === 'string' ? payload.action : '';
    const reviewNote = typeof payload.review_note === 'string' ? payload.review_note.trim() : '';

    if (action !== 'approve' && action !== 'reject') {
      res.status(400).json({ error: 'Invalid action.' });
      return;
    }

    try {
      const { data: existingOrder, error: orderLoadError } = await supabase
        .from('afterparty_orders')
        .select('id')
        .eq('id', id)
        .maybeSingle();

      if (orderLoadError) {
        throw orderLoadError;
      }
      if (!existingOrder) {
        res.status(404).json({ error: 'Order not found.' });
        return;
      }

      const { data: items, error: itemsError } = await supabase
        .from('afterparty_order_items')
        .select('id, quantity, approved_quantity, points_each')
        .eq('order_id', id);

      if (itemsError) {
        throw itemsError;
      }

      if (action === 'reject') {
        const { error: itemsUpdateError } = await supabase
          .from('afterparty_order_items')
          .update({ approved_quantity: 0, points_total: 0 })
          .eq('order_id', id);
        if (itemsUpdateError) {
          throw itemsUpdateError;
        }

        const { error: orderUpdateError } = await supabase
          .from('afterparty_orders')
          .update({
            status: 'rejected',
            total_points: 0,
            review_note: reviewNote || null,
            reviewed_at: new Date().toISOString(),
            reviewed_by: null,
          })
          .eq('id', id);
        if (orderUpdateError) {
          throw orderUpdateError;
        }
        res.status(200).json({ ok: true });
        return;
      }

      const reviewQuantities = parseAfterpartyReviewItems(payload);
      const approvedItems = ((items ?? []) as Array<{
        id: string;
        quantity: number | null;
        approved_quantity: number | null;
        points_each: number | null;
      }>).map((item) => {
        const fallbackQuantity = parseNonNegativeInt(item.approved_quantity ?? item.quantity, 0);
        const approvedQuantity = reviewQuantities.has(item.id)
          ? parseNonNegativeInt(reviewQuantities.get(item.id), fallbackQuantity)
          : fallbackQuantity;
        const pointsEach = parseNonNegativeInt(item.points_each, 0);
        return {
          id: item.id,
          approvedQuantity,
          pointsTotal: approvedQuantity * pointsEach,
        };
      });

      const updateResults = await Promise.all(
        approvedItems.map((item) =>
          supabase
            .from('afterparty_order_items')
            .update({
              approved_quantity: item.approvedQuantity,
              points_total: item.pointsTotal,
            })
            .eq('id', item.id)
            .eq('order_id', id),
        ),
      );
      const updateError = updateResults.find((result) => result.error)?.error;
      if (updateError) {
        throw updateError;
      }

      const totalPoints = approvedItems.reduce((sum, item) => sum + item.pointsTotal, 0);
      const { error: orderUpdateError } = await supabase
        .from('afterparty_orders')
        .update({
          status: 'approved',
          total_points: totalPoints,
          review_note: reviewNote || null,
          reviewed_at: new Date().toISOString(),
          reviewed_by: null,
        })
        .eq('id', id);
      if (orderUpdateError) {
        throw orderUpdateError;
      }

      res.status(200).json({ ok: true, total_points: totalPoints });
    } catch (error) {
      console.error('[api/content/admin/afterparty] failed to review order', error);
      res.status(500).json({ error: 'Failed to review afterparty order.' });
    }
    return;
  }

  if (resource === 'reset' && req.method === 'POST') {
    try {
      const { data: receiptRows, error: receiptError } = await supabase.from('afterparty_orders').select('receipt_path');

      if (receiptError) {
        throw receiptError;
      }

      const receiptPaths = Array.from(
        new Set(
          ((receiptRows ?? []) as Array<{ receipt_path?: string | null }>)
            .map((row) => row.receipt_path?.trim() ?? '')
            .filter(Boolean),
        ),
      );

      for (let index = 0; index < receiptPaths.length; index += 100) {
        const chunk = receiptPaths.slice(index, index + 100);
        const { error: storageError } = await supabase.storage.from(AFTERPARTY_RECEIPTS_BUCKET).remove(chunk);
        if (storageError) {
          throw storageError;
        }
      }

      const { error: itemsDeleteError } = await supabase
        .from('afterparty_order_items')
        .delete()
        .not('id', 'is', null);
      if (itemsDeleteError) {
        throw itemsDeleteError;
      }

      const { error: ordersDeleteError } = await supabase.from('afterparty_orders').delete().not('id', 'is', null);
      if (ordersDeleteError) {
        throw ordersDeleteError;
      }

      const { error: participantsDeleteError } = await supabase
        .from('afterparty_participants')
        .delete()
        .not('id', 'is', null);
      if (participantsDeleteError) {
        throw participantsDeleteError;
      }

      res.status(200).json({ ok: true, deleted_receipts: receiptPaths.length });
    } catch (error) {
      console.error('[api/content/admin/afterparty] failed to reset league', error);
      res.status(500).json({ error: 'Failed to reset afterparty league.' });
    }
    return;
  }

  res.status(405).json({ error: 'Method not allowed' });
}

function mapPionyr(article: PionyrArticle): PublicArticle {
  return {
    source: 'pionyr',
    slug: article.slug,
    title: article.title,
    excerpt: article.excerpt,
    dateISO: article.dateISO,
    author: article.author ?? null,
    coverImage: article.coverImageUrl ? { url: article.coverImageUrl, alt: article.coverImageAlt } : null,
    body: article.bodyHtml ?? null,
    bodyFormat: 'html',
  };
}

const SYNC_EDIT_GRACE_MS = 60_000;

function wasEditedAfterSync(row: { updated_at?: string | null; synced_at?: string | null }) {
  if (!row.updated_at || !row.synced_at) {
    return false;
  }
  const updatedAt = Date.parse(row.updated_at);
  const syncedAt = Date.parse(row.synced_at);
  if (!Number.isFinite(updatedAt) || !Number.isFinite(syncedAt)) {
    return false;
  }
  return updatedAt - syncedAt > SYNC_EDIT_GRACE_MS;
}

function formatImportError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function mapLocalRow(row: LocalArticleRow): PublicArticle {
  const source = row.source === 'pionyr' ? 'pionyr' : 'local';
  return {
    source,
    slug: row.slug,
    title: row.title,
    excerpt: row.excerpt ?? '',
    dateISO: row.published_at ?? row.created_at,
    author: row.author,
    coverImage: row.cover_image_url ? { url: row.cover_image_url, alt: row.cover_image_alt } : null,
    body: row.body,
    bodyFormat: source === 'pionyr' ? 'html' : 'text',
  };
}

function mapLocalSummaryRow(row: LocalArticleSummaryRow): PublicArticle {
  const source = row.source === 'pionyr' ? 'pionyr' : 'local';
  return {
    source,
    slug: row.slug,
    title: row.title,
    excerpt: row.excerpt ?? '',
    dateISO: row.published_at ?? row.created_at,
    author: row.author,
    coverImage: row.cover_image_url ? { url: row.cover_image_url, alt: row.cover_image_alt } : null,
  };
}

async function fetchLocalArticleSummaries({
  limit,
  offset = 0,
}: {
  limit: number;
  offset?: number;
}): Promise<{ articles: PublicArticle[]; hasMore: boolean }> {
  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from('content_articles')
    .select('slug,title,excerpt,author,cover_image_url,cover_image_alt,published_at,created_at,source')
    .eq('status', 'published')
    .order('published_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .range(offset, offset + limit);

  if (error) {
    console.error('[api/content] supabase error', error);
    throw error;
  }

  const rows = (data ?? []) as LocalArticleSummaryRow[];
  return {
    articles: rows.slice(0, limit).map(mapLocalSummaryRow),
    hasMore: rows.length > limit,
  };
}

async function handlePublicList(req: any, res: any) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=3600, stale-while-revalidate=86400');
  try {
    const requestedLimit = parseNonNegativeInt(req.query?.limit, PUBLIC_ARTICLE_PAGE_SIZE);
    const limit = Math.min(PUBLIC_ARTICLE_MAX_PAGE_SIZE, Math.max(1, requestedLimit));
    const offset = parseNonNegativeInt(req.query?.offset, 0);
    const { articles, hasMore } = await fetchLocalArticleSummaries({ limit, offset });
    res.status(200).json({
      articles,
      hasMore,
      nextOffset: hasMore ? offset + articles.length : null,
    });
  } catch (error) {
    console.error('[api/content/articles] failed', error);
    res.status(500).json({ error: 'Failed to load articles.' });
  }
}

async function handlePublicDetail(req: any, res: any, slug: string) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=3600, stale-while-revalidate=86400');
  try {
    const supabase = getSupabaseAdminClient();
    const { data, error } = await supabase
      .from('content_articles')
      .select(
        'id,slug,title,excerpt,body,author,cover_image_url,cover_image_alt,status,published_at,created_at,source',
      )
      .eq('slug', slug)
      .eq('status', 'published')
      .maybeSingle();

    if (!error && data) {
      const row = data as LocalArticleRow;
      res.status(200).json({ article: mapLocalRow(row) });
      return;
    }

    const pionyrArticle = await fetchPionyrArticleBySlug(slug);
    if (!pionyrArticle) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    res.status(200).json({ article: mapPionyr(pionyrArticle) });
  } catch (error) {
    console.error('[api/content/articles/[slug]] failed', error);
    res.status(500).json({ error: 'Failed to load article.' });
  }
}

async function handlePublicSitemap(req: any, res: any) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const { articles } = await fetchLocalArticleSummaries({ limit: 3 });
    const latestArticles = articles
      .map((article) => {
        const lastmod = normalizeSitemapLastmod(article.dateISO);
        return renderSitemapUrl({
          loc: `${SITEMAP_BASE_URL}/clanky/${encodeURIComponent(article.slug)}`,
          lastmod: lastmod ?? undefined,
          changefreq: 'daily',
          priority: 0.7,
        });
      });

    const staticUrls = SITEMAP_STATIC_ENTRIES.map((entry) =>
      renderSitemapUrl({
        loc: `${SITEMAP_BASE_URL}${entry.path}`,
        changefreq: entry.changefreq,
        priority: entry.priority,
      }),
    );

    const body = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
      ...staticUrls,
      ...latestArticles,
      '</urlset>',
    ].join('\n');

    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Cache-Control', 'public, s-maxage=900, stale-while-revalidate=300');
    if (req.method === 'HEAD') {
      res.status(200).end();
      return;
    }
    res.status(200).send(body);
  } catch (error) {
    console.error('[api/content/sitemap] failed', error);
    res.status(500).json({ error: 'Failed to load sitemap.' });
  }
}

function isImportAuthorized(req: any, res: any): boolean {
  const secret = process.env.CONTENT_IMPORT_SECRET ?? '';
  const cronSecret = process.env.CRON_SECRET ?? '';
  const authHeader = typeof req.headers?.authorization === 'string' ? req.headers.authorization : '';
  const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  if (cronSecret && bearerToken === cronSecret) {
    return true;
  }
  if (secret) {
    const querySecret = typeof req.query?.secret === 'string' ? req.query.secret : '';
    const headerSecret = typeof req.headers?.['x-import-secret'] === 'string' ? req.headers['x-import-secret'] : '';
    if (querySecret === secret || headerSecret === secret) {
      return true;
    }
  }
  return requireEditor(req, res);
}

async function handleAdminImport(req: any, res: any) {
  if (!isImportAuthorized(req, res)) {
    return;
  }
  if (req.method !== 'POST' && req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  const includeErrorDetails =
    process.env.NODE_ENV !== 'production' ||
    req.query?.debug === '1' ||
    req.headers?.['x-debug-import'] === '1';

  try {
    const list = await fetchPionyrArticles();
    const { cachePionyrArticleImages } = await import('../api-lib/content/articleImageR2.js');
    const enriched = await Promise.all(
      list.map(async (article) => {
        const detail = await fetchPionyrArticleBySlug(article.slug);
        const withDetail = detail
          ? {
              ...article,
              ...detail,
              excerpt: detail.excerpt || article.excerpt,
              dateISO: detail.dateISO || article.dateISO,
              coverImageUrl: detail.coverImageUrl || article.coverImageUrl,
              coverImageAlt: detail.coverImageAlt || article.coverImageAlt,
            }
          : article;
        return cachePionyrArticleImages(withDetail);
      }),
    );

    const now = new Date().toISOString();
    const rows = enriched.map((article) => ({
      slug: article.slug,
      title: article.title,
      excerpt: article.excerpt ?? '',
      body: article.bodyHtml ?? null,
      author: article.author ?? null,
      cover_image_url: article.coverImageUrl ?? null,
      cover_image_alt: article.coverImageAlt ?? null,
      status: 'published',
      published_at: article.dateISO ?? now,
      source: 'pionyr',
      external_id: article.slug,
      synced_at: now,
    }));

    const supabase = getSupabaseAdminClient();
    const { data: existingRows, error: existingError } = await supabase
      .from('content_articles')
      .select('id,external_id,updated_at,synced_at')
      .eq('source', 'pionyr');
    if (existingError) {
      console.error('[api/content/import] failed to load existing rows', existingError);
      res.status(500).json({
        error: 'Failed to load imported articles.',
        ...(includeErrorDetails ? { details: formatImportError(existingError) } : {}),
      });
      return;
    }

    const existingByExternalId = new Map<string, ImportedArticleRow>();
    (existingRows ?? []).forEach((row: ImportedArticleRow) => {
      if (typeof row.external_id === 'string' && row.external_id.trim()) {
        existingByExternalId.set(row.external_id, row);
      }
    });

    const upserts: typeof rows = [];
    const skipped: string[] = [];
    rows.forEach((row) => {
      const existing = existingByExternalId.get(row.external_id);
      if (existing && wasEditedAfterSync(existing)) {
        skipped.push(row.external_id);
        return;
      }
      upserts.push(row);
    });

    if (upserts.length > 0) {
      const { error: upsertError } = await supabase
        .from('content_articles')
        .upsert(upserts, { onConflict: 'source,external_id' });
      if (upsertError) {
        console.error('[api/content/import] failed to upsert rows', upsertError);
        res.status(500).json({
          error: 'Failed to import articles.',
          ...(includeErrorDetails ? { details: formatImportError(upsertError) } : {}),
        });
        return;
      }
    }

    const incomingExternalIds = new Set(rows.map((row) => row.external_id));
    const deleteIds = (existingRows ?? [])
      .filter((row: ImportedArticleRow) => {
        if (!row.external_id || incomingExternalIds.has(row.external_id)) {
          return false;
        }
        return !wasEditedAfterSync(row);
      })
      .map((row: ImportedArticleRow) => row.id);

    if (deleteIds.length > 0) {
      const { error: deleteError } = await supabase.from('content_articles').delete().in('id', deleteIds);
      if (deleteError) {
        console.error('[api/content/import] failed to delete stale rows', deleteError);
        res.status(500).json({
          error: 'Failed to clear imported articles.',
          ...(includeErrorDetails ? { details: formatImportError(deleteError) } : {}),
        });
        return;
      }
    }

    res.status(200).json({
      ok: true,
      imported: rows.length,
      updated: upserts.length,
      skipped: skipped.length,
      deleted: deleteIds.length,
    });
  } catch (error) {
    console.error('[api/content/import] failed', error);
    res.status(500).json({
      error: 'Failed to import articles.',
      ...(includeErrorDetails ? { details: formatImportError(error) } : {}),
    });
  }
}

async function handleAdminSession(req: any, res: any) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  const { ok } = verifyEditorSession(req);
  if (!ok) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  res.status(200).json({ ok: true });
}

async function handleAdminLogin(req: any, res: any) {
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  const payload = resolveBody(req);
  const password = typeof payload.password === 'string' ? payload.password : '';
  try {
    if (!validatePassword(password)) {
      res.status(401).json({ error: 'Invalid password' });
      return;
    }
    setEditorSession(res);
    res.status(200).json({ ok: true });
  } catch {
    res.status(500).json({ error: 'Failed to authenticate' });
  }
}

async function handleAdminLogout(req: any, res: any) {
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  clearEditorSession(res);
  res.status(200).json({ ok: true });
}

async function handleAdminArticles(req: any, res: any) {
  if (!requireEditor(req, res)) {
    return;
  }
  const supabase = getSupabaseAdminClient();

  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('content_articles')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) {
      res.status(500).json({ error: 'Failed to load articles.' });
      return;
    }
    res.status(200).json({ articles: data ?? [] });
    return;
  }

  if (req.method === 'POST') {
    const payload = resolveBody(req);
    const title = typeof payload.title === 'string' ? payload.title.trim() : '';
    if (!title) {
      res.status(400).json({ error: 'Missing title.' });
      return;
    }
    const status =
      typeof payload.status === 'string' && ['draft', 'published'].includes(payload.status)
        ? payload.status
        : 'draft';
    const slug =
      typeof payload.slug === 'string' && payload.slug.trim().length > 0 ? payload.slug.trim() : slugify(title);
    const now = new Date().toISOString();
    const publishedAt = status === 'published' ? (payload.published_at as string | undefined) ?? now : null;

    const { data, error } = await supabase
      .from('content_articles')
      .insert({
        slug,
        title,
        excerpt: typeof payload.excerpt === 'string' ? payload.excerpt : null,
        body: typeof payload.body === 'string' ? payload.body : null,
        author: typeof payload.author === 'string' ? payload.author : null,
        cover_image_url: typeof payload.cover_image_url === 'string' ? payload.cover_image_url : null,
        cover_image_alt: typeof payload.cover_image_alt === 'string' ? payload.cover_image_alt : null,
        status,
        published_at: publishedAt,
      })
      .select('*')
      .single();

    if (error) {
      res.status(500).json({ error: 'Failed to create article.' });
      return;
    }
    res.status(200).json({ article: data });
    return;
  }

  res.status(405).json({ error: 'Method not allowed' });
}

async function handleAdminArticle(req: any, res: any, id: string) {
  if (!requireEditor(req, res)) {
    return;
  }
  const supabase = getSupabaseAdminClient();

  if (req.method === 'PUT') {
    const payload = resolveBody(req);
    const status =
      typeof payload.status === 'string' && ['draft', 'published'].includes(payload.status)
        ? payload.status
        : undefined;
    let publishedAt: string | null | undefined = undefined;

    if (status === 'draft') {
      publishedAt = null;
    } else if (status === 'published') {
      if (typeof payload.published_at === 'string' && payload.published_at.trim().length > 0) {
        publishedAt = payload.published_at;
      } else {
        const { data: existingArticle, error: existingArticleError } = await supabase
          .from('content_articles')
          .select('status,published_at')
          .eq('id', id)
          .maybeSingle();
        if (existingArticleError) {
          res.status(500).json({ error: 'Failed to load existing article state.' });
          return;
        }
        if (!existingArticle) {
          res.status(404).json({ error: 'Article not found.' });
          return;
        }
        const existingStatus = (existingArticle as { status?: string | null }).status ?? null;
        const existingPublishedAt = (existingArticle as { published_at?: string | null }).published_at ?? null;
        if (!(existingStatus === 'published' && existingPublishedAt)) {
          publishedAt = new Date().toISOString();
        }
      }
    }

    const update: Record<string, unknown> = {};
    if (typeof payload.slug === 'string') update.slug = payload.slug.trim();
    if (typeof payload.title === 'string') update.title = payload.title.trim();
    if (typeof payload.excerpt === 'string') update.excerpt = payload.excerpt;
    if (typeof payload.body === 'string') update.body = payload.body;
    if (typeof payload.author === 'string') update.author = payload.author;
    if (typeof payload.cover_image_url === 'string') update.cover_image_url = payload.cover_image_url;
    if (typeof payload.cover_image_alt === 'string') update.cover_image_alt = payload.cover_image_alt;
    if (status) update.status = status;
    if (publishedAt !== undefined) update.published_at = publishedAt;

    const { data, error } = await supabase
      .from('content_articles')
      .update(update)
      .eq('id', id)
      .select('*')
      .single();

    if (error) {
      res.status(500).json({ error: 'Failed to update article.' });
      return;
    }
    res.status(200).json({ article: data });
    return;
  }

  if (req.method === 'DELETE') {
    const { error } = await supabase.from('content_articles').delete().eq('id', id);
    if (error) {
      res.status(500).json({ error: 'Failed to delete article.' });
      return;
    }
    res.status(200).json({ ok: true });
    return;
  }

  res.status(405).json({ error: 'Method not allowed' });
}

async function handleAdminArticleImages(req: any, res: any) {
  if (!requireEditor(req, res)) {
    return;
  }
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const payload = resolveBody(req);
  const filesRaw = Array.isArray(payload.files) ? payload.files : [];
  if (filesRaw.length === 0) {
    res.status(400).json({ error: 'Chybí soubory pro upload.' });
    return;
  }
  if (filesRaw.length > 20) {
    res.status(400).json({ error: 'Najednou můžeš nahrát maximálně 20 souborů.' });
    return;
  }

  const files: ArticleImageUploadRequest[] = [];
  for (const entry of filesRaw) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }
    const name = typeof (entry as any).name === 'string' ? (entry as any).name.trim() : '';
    const type = typeof (entry as any).type === 'string' ? (entry as any).type.trim().toLowerCase() : '';
    const size = typeof (entry as any).size === 'number' ? (entry as any).size : undefined;
    if (!name || !type) {
      continue;
    }
    files.push({ name, type, size });
  }

  if (files.length === 0) {
    res.status(400).json({ error: 'Neplatný seznam souborů.' });
    return;
  }

  const invalidType = files.find((file) => !CONTENT_ARTICLE_ALLOWED_IMAGE_TYPES.has(file.type));
  if (invalidType) {
    res.status(400).json({ error: `Typ souboru ${invalidType.type} není povolený.` });
    return;
  }
  const tooLarge = files.find((file) => typeof file.size === 'number' && file.size > 10 * 1024 * 1024);
  if (tooLarge) {
    res.status(400).json({ error: `Soubor ${tooLarge.name} je větší než 10 MB.` });
    return;
  }

  const supabase = getSupabaseAdminClient();
  const now = new Date();
  const year = String(now.getFullYear());
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const stamp = now.getTime();

  try {
    const uploads = [];
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      const ext = resolveArticleImageExtension(file.name, file.type);
      const stem = slugify(file.name.replace(/\.[^.]+$/, '')) || 'image';
      const random = Math.random().toString(36).slice(2, 10);
      const path = `articles/${year}/${month}/${stamp}-${index}-${random}-${stem.slice(0, 80)}.${ext}`;
      const signed = await supabase.storage
        .from(CONTENT_ARTICLE_IMAGES_BUCKET)
        .createSignedUploadUrl(path, { upsert: false });
      if (signed.error || !signed.data) {
        throw signed.error ?? new Error('Failed to create signed upload URL.');
      }
      const publicUrl = supabase.storage.from(CONTENT_ARTICLE_IMAGES_BUCKET).getPublicUrl(path).data.publicUrl;
      uploads.push({
        fileName: file.name,
        contentType: file.type,
        path,
        token: signed.data.token,
        publicUrl,
      });
    }

    res.status(200).json({ uploads });
  } catch (error) {
    console.error('[api/content/admin/article-images] failed to prepare upload', error);
    res.status(500).json({ error: 'Nepodařilo se připravit upload obrázků.' });
  }
}

async function handlePublicLeague(req: any, res: any) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=600');
  try {
    const supabase = getSupabaseAdminClient();
    try {
      const payload = await loadLeagueSeasons(supabase);
      res.status(200).json(payload);
      return;
    } catch (error) {
      if (!isMissingLeagueSeasonSchemaError(error)) {
        throw error;
      }
    }

    const { data, error } = await supabase
      .from('content_league_scores')
      .select('troop_id,event_key,points');
    if (error) {
      res.status(500).json({ error: 'Failed to load league scores.' });
      return;
    }
    res.status(200).json({ scores: (data ?? []) as LeagueScoreRow[] });
  } catch (error) {
    console.error('[api/content/league] failed', error);
    res.status(500).json({ error: 'Failed to load league scores.' });
  }
}

async function handleAdminLeague(req: any, res: any) {
  if (!requireEditor(req, res)) {
    return;
  }
  const supabase = getSupabaseAdminClient();

  if (req.method === 'GET') {
    try {
      const payload = await loadLeagueSeasons(supabase);
      res.status(200).json(payload);
      return;
    } catch (error) {
      if (!isMissingLeagueSeasonSchemaError(error)) {
        res.status(500).json({ error: 'Failed to load league seasons.' });
        return;
      }
    }

    const { data, error } = await supabase
      .from('content_league_scores')
      .select('troop_id,event_key,points');
    if (error) {
      res.status(500).json({ error: 'Failed to load league scores.' });
      return;
    }
    res.status(200).json({ scores: (data ?? []) as LeagueScoreRow[] });
    return;
  }

  if (req.method === 'PUT') {
    const payload = resolveBody(req);
    const season = parseLeagueSeason(payload);
    const troops = parseLeagueTroops(payload);
    const events = parseLeagueEvents(payload);
    const scores = parseLeagueScores(payload) ?? [];
    if (!season.id || !season.name || troops.length === 0 || events.length === 0) {
      res.status(400).json({ error: 'Invalid payload.' });
      return;
    }

    try {
      if (season.is_active) {
        const { error: deactivateError } = await supabase
          .from('content_league_seasons')
          .update({ is_active: false })
          .neq('id', season.id);
        if (deactivateError) {
          throw deactivateError;
        }
      }

      const { error: seasonError } = await supabase
        .from('content_league_seasons')
        .upsert(season, { onConflict: 'id' });
      if (seasonError) {
        throw seasonError;
      }

      const { error: deleteTroopsError } = await supabase
        .from('content_league_season_troops')
        .delete()
        .eq('season_id', season.id);
      if (deleteTroopsError) {
        throw deleteTroopsError;
      }

      const seasonTroops = troops.map((troop) => ({ ...troop, season_id: season.id }));
      if (seasonTroops.length > 0) {
        const { error: troopsError } = await supabase
          .from('content_league_season_troops')
          .insert(seasonTroops);
        if (troopsError) {
          throw troopsError;
        }
      }

      const { error: deleteEventsError } = await supabase
        .from('content_league_season_events')
        .delete()
        .eq('season_id', season.id);
      if (deleteEventsError) {
        throw deleteEventsError;
      }

      const seasonEvents = events.map((event) => ({ ...event, season_id: season.id }));
      if (seasonEvents.length > 0) {
        const { error: eventsError } = await supabase
          .from('content_league_season_events')
          .insert(seasonEvents);
        if (eventsError) {
          throw eventsError;
        }
      }

      const { error: deleteScoresError } = await supabase
        .from('content_league_scores')
        .delete()
        .eq('season_id', season.id);
      if (deleteScoresError) {
        throw deleteScoresError;
      }

      if (scores.length > 0) {
        const seasonScores = scores.map((score) => ({ ...score, season_id: season.id }));
        const { error: scoresError } = await supabase
          .from('content_league_scores')
          .insert(seasonScores);
        if (scoresError) {
          throw scoresError;
        }
      }

      const nextPayload = await loadLeagueSeasons(supabase);
      res.status(200).json({ ok: true, ...nextPayload });
      return;
    } catch (error) {
      if (isMissingLeagueSeasonSchemaError(error) && scores.length > 0) {
        const legacyScores = scores.map(({ troop_id, event_key, points }) => ({ troop_id, event_key, points }));
        const { error: legacyError } = await supabase
          .from('content_league_scores')
          .upsert(legacyScores, { onConflict: 'troop_id,event_key' });
        if (!legacyError) {
          res.status(200).json({ ok: true, scores: legacyScores });
          return;
        }
      }
      console.error('[api/content/admin/league] failed to save league seasons', error);
      res.status(500).json({ error: 'Failed to save league seasons.' });
      return;
    }
  }

  res.status(405).json({ error: 'Method not allowed' });
}

async function handleAdminAlbumTitles(req: any, res: any) {
  if (!requireEditor(req, res)) {
    return;
  }
  const supabase = getSupabaseAdminClient();

  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('content_gallery_albums')
      .select('folder_id,title,created_at,updated_at')
      .order('updated_at', { ascending: false });
    if (error) {
      res.status(500).json({ error: 'Failed to load album titles.' });
      return;
    }
    res.status(200).json({ items: (data ?? []) as AlbumTitleRow[] });
    return;
  }

  if (req.method === 'PUT' || req.method === 'POST') {
    const payload = resolveBody(req);
    const { upserts, deletes } = parseAlbumTitlePayload(payload);

    if (upserts.length > 0) {
      const { error } = await supabase
        .from('content_gallery_albums')
        .upsert(upserts, { onConflict: 'folder_id' });
      if (error) {
        res.status(500).json({ error: 'Failed to save album titles.' });
        return;
      }
    }

    if (deletes.length > 0) {
      const { error } = await supabase.from('content_gallery_albums').delete().in('folder_id', deletes);
      if (error) {
        res.status(500).json({ error: 'Failed to delete album titles.' });
        return;
      }
    }

    res.status(200).json({ ok: true, updated: upserts.length, deleted: deletes.length });
    return;
  }

  res.status(405).json({ error: 'Method not allowed' });
}

export default async function handler(req: any, res: any) {
  const rawPath = req.query?.path;
  let segments = Array.isArray(rawPath)
    ? rawPath
    : typeof rawPath === 'string'
      ? rawPath.split('/').filter(Boolean)
      : [];

  if (segments.length === 0 && typeof req.url === 'string') {
    try {
      const url = new URL(req.url, 'http://localhost');
      const prefix = '/api/content';
      const index = url.pathname.indexOf(prefix);
      if (index >= 0) {
        const rest = url.pathname.slice(index + prefix.length).replace(/^\/+/, '');
        segments = rest.split('/').filter(Boolean);
      }
    } catch {
      // ignore malformed URL and fall back to empty segments
    }
  }

  if (segments.length === 0) {
    res.status(404).json({ error: 'Not found' });
    return;
  }

  if (segments[0] === 'articles') {
    if (segments.length === 1) {
      await handlePublicList(req, res);
      return;
    }
    if (segments.length >= 2) {
      let articleSlug = segments[1];
      try {
        articleSlug = decodeURIComponent(articleSlug);
      } catch {
        // Keep the raw slug when the URL contains malformed escape sequences.
      }
      await handlePublicDetail(req, res, articleSlug);
      return;
    }
  }

  if (segments[0] === 'sitemap') {
    await handlePublicSitemap(req, res);
    return;
  }

  if (segments[0] === 'league') {
    await handlePublicLeague(req, res);
    return;
  }

  if (segments[0] === 'admin') {
    const action = segments[1] ?? '';
    if (action === 'session') {
      await handleAdminSession(req, res);
      return;
    }
    if (action === 'login') {
      await handleAdminLogin(req, res);
      return;
    }
    if (action === 'logout') {
      await handleAdminLogout(req, res);
      return;
    }
    if (action === 'articles') {
      if (segments.length === 2) {
        await handleAdminArticles(req, res);
        return;
      }
      if (segments.length >= 3) {
        await handleAdminArticle(req, res, segments[2]);
        return;
      }
    }
    if (action === 'article-images') {
      await handleAdminArticleImages(req, res);
      return;
    }
    if (action === 'import') {
      await handleAdminImport(req, res);
      return;
    }
    if (action === 'league') {
      await handleAdminLeague(req, res);
      return;
    }
    if (action === 'afterparty') {
      await handleAdminAfterparty(req, res, segments.slice(2));
      return;
    }
    if (action === 'albums') {
      await handleAdminAlbumTitles(req, res);
      return;
    }
  }

  res.status(404).json({ error: 'Not found' });
}
