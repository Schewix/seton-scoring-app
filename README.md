# Zelená liga

`Zelená liga` je monorepo pro `Setonův závod - aplikace` (web rozhodčích na stanovištích), modul `Deskové hry`, veřejný scoreboard výsledků, Supabase backend, import hlídek z Google Sheets a provozní utility (včetně QR kódů). Aplikace podporuje offline frontu (IndexedDB/localforage), Supabase Realtime a nasazení přes Vercel + GitHub Actions.

## Rychlý start

1. **Node.js 20 + pnpm/npm**
   - CI běží na Node 20.
   - Instalace po složkách: `pnpm -C web install`, `pnpm -C server install`, `pnpm -C scripts install`.
2. **Supabase**
   - Lokálně: `supabase start`.
   - Migrace: [`supabase/migrations`](./supabase/migrations).
3. **Backend (Express)**
   - Nastav `server/.env` podle ukázky a spusť `pnpm -C server dev`.
4. **Web (React + Vite)**
   - Nastav `web/.env.local` a spusť `pnpm -C web dev`.

## Repo Overview

| Složka | Popis |
| --- | --- |
| [`web/`](./web) | React + Vite aplikace: rozhodčí UI + scoreboard, PWA, offline queue, testy. |
| [`server/`](./server) | Express API pro auth, session tokeny a manifest stanoviště. |
| [`supabase/migrations`](./supabase/migrations) | Supabase CLI migrace (schema, RLS, pohledy, RPC). |
| [`supabase/sql`](./supabase/sql) | Ruční SQL skripty a event seed data. |
| [`supabase/functions/`](./supabase/functions) | Edge Functions (např. sync hlídek, submit záznamů). |
| [`google-sheets/`](./google-sheets) | Popis Google Sheets šablony pro import hlídek. |
| [`scripts/`](./scripts) | Utility skripty (např. generování QR kódů hlídek). |
| [`docs/`](./docs) | Uživatelská a provozní dokumentace. |

## Backend (Express API)

Server v [`server/`](./server) řeší:

- `POST /auth/login` (přihlášení rozhodčího + session + tokeny + manifest),
- `GET /manifest` (aktualizace manifestu stanoviště),
- admin endpointy pro kancelářní operace.

Lokální spuštění:

```bash
cd server
pnpm install
pnpm dev
```

Ukázka `server/.env`:

```bash
# Zelená liga backend
SUPABASE_URL=https://<projekt>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
JWT_SECRET=<tajny-klic-access-token>
REFRESH_TOKEN_SECRET=<tajny-klic-refresh-token>

# TTL (sekundy)
ACCESS_TOKEN_TTL_SECONDS=900
REFRESH_TOKEN_TTL_SECONDS=1209600

# Volitelné: explicitní origin pro CORS (produkce)
CORS_ORIGIN=https://zelenaliga.cz

PORT=8787
```

## Web (React + Vite)

Web v [`web/`](./web) poskytuje:

- `Setonův závod - aplikace` na `/aplikace/setonuv-zavod`,
- scoreboard k aplikaci na `/aplikace/setonuv-zavod/vysledky` (aliasy `/vysledky`, `/scoreboard`, `?view=vysledky`),
- `Deskové hry` na `/aplikace/deskovky` (alias `/deskovky`),
- QR scan přes ZXing,
- offline queue v IndexedDB/localforage,
- realtime přehled výsledků přes Supabase.

Lokální spuštění:

```bash
cd web
pnpm install
pnpm dev
```

Ukázka `web/.env.local`:

```bash
VITE_SUPABASE_URL=https://<projekt>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon-key>

# Kontext aktivního závodu a stanoviště
VITE_EVENT_ID=<uuid-eventu>
VITE_STATION_ID=<uuid-stanoviste>

# Auth backend (Express)
VITE_AUTH_API_URL=https://zelenaliga.cz

# Volitelné přepínače pro vývoj
VITE_AUTH_BYPASS=1
VITE_ADMIN_MODE=1
```

## Deskové Hry Modul

Nový modul běží ve webu na trasách:

- `/aplikace/deskovky` (rozhodčí dashboard),
- `/aplikace/deskovky/match/new` (scan 4 hráčů + zápis výsledku),
- `/aplikace/deskovky/standings` (průběžné pořadí),
- `/aplikace/deskovky/pravidla` (PDF pravidel),
- `/aplikace/deskovky/admin` (administrace turnaje).

Používá stejné přihlášení jako Seton (`/auth/login`, stejné session tokeny).

Výpočet pořadí v SQL (`board_game_standings`, `board_overall_standings`) respektuje:

- sdílená místa jako průměr obsazených pozic (např. 10.5),
- konfigurovatelné hlavní kritérium na hře:
  - `scoring_type=placement` -> nižší součet pořadí je lepší,
  - `scoring_type=points`/`both` -> směr bodů podle `points_order` (`asc` nebo `desc`),
- volitelnou úpravu pro partie o 3 hráčích (`three_player_adjustment=true`):
  - body `* 0.75`,
  - pořadí `1 -> 1`, `2 -> 2.5`, `3 -> 4`,
- celkové pořadí v kategorii jako součet pořadí her (nižší součet je lepší),
- tie-break v kategorii přes `board_category.primary_game_id` (hlavní hra), pak nejlepší výkon v hlavní hře.

Aktuální plánované kombinace her lze kdykoliv změnit v adminu:

- I + II: `Dobble` + `Tajná výprava čarodějů` (hlavní hra: `Tajná výprava čarodějů`),
- III + IV: `Hop!` + `Ubongo` (hlavní hra: `Ubongo`),
- V + VI: `Kris kros` + (`Milostný dopis` nebo `Dominion`) (hlavní hra: `Kris kros`).

### Demo Seed

1. Aplikuj migrace:
   - `supabase db push`
2. Načti demo data Deskovek:
   - `supabase db query < supabase/sql/deskovky_demo_seed.sql`
3. Doplň přiřazení rozhodčího (UUID z `public.judges`) podle komentáře v seed souboru.

### Tisk Visaček (QR)

1. Otevři `/aplikace/deskovky/admin`.
2. V sekci `Hráči` klikni na `Export visaček (CSV)`.
3. CSV obsahuje `qr_payload` ve formátu `https://zelenaliga.cz/deskovky/p/<short_code>` pro tisk visaček.

## Security Notes

- Nikdy necommituj `SUPABASE_SERVICE_ROLE_KEY`.
- Všechny citlivé hodnoty drž v `.env*` a v produkci jako Vercel secrets.
- `SUPABASE_SERVICE_ROLE_KEY`, `JWT_SECRET`, `REFRESH_TOKEN_SECRET` musí být jen na server-side.
- Klient (`web`) smí používat pouze `VITE_SUPABASE_ANON_KEY` a veřejné proměnné.

## Supabase & Google Sheets

1. Migrace spravuj přes `supabase db push` / `supabase db reset`.
2. Import hlídek lze řešit přes:
   - Apps Script/Sheets workflow popsaný v [`google-sheets/SHEET_TEMPLATE_INFO.md`](./google-sheets/SHEET_TEMPLATE_INFO.md),
   - Supabase Edge Function `sync-patrols`.
3. QR kódy hlídek generuje [`scripts/generate-qr-codes.mjs`](./scripts/generate-qr-codes.mjs).

Poznámka: názvy DB objektů (tabulky/pohledy/policies) zůstávají stabilní kvůli kompatibilitě migrací a nasazených klientů.

## CI/CD

- GitHub workflow `deploy-vercel.yml`: build + deploy webu na Vercel.
- GitHub workflow `supabase.yml`: nasazení migrací do Supabase.

### Deployment notes

- Node.js: **20**
- Web build: `npm ci && npm run build` ve složce `web/`
- Nutné Vercel secrets: `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`, `VERCEL_TOKEN`
- Nutné runtime env proměnné: viz sekce backend/web výše

## Renaming Checklist

Po merge udělej ručně:

1. GitHub repository rename (název + případně topics).
2. Vercel project rename (a zkontrolovat propojení s GitHub repem).
3. Aktualizovat domény/redirecty (`zelenaliga.cz`, custom domény).
4. Zkontrolovat všechny env vars a secrets v CI/Vercelu/Supabase.
