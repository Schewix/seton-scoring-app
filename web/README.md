# Webový klient Seton Scoring App

Tato složka obsahuje hlavní webovou aplikaci projektu – rozhraní pro rozhodčí na stanovištích i veřejný výsledkový přehled. Projekt využívá React, TypeScript, Vite a Supabase klienta. Build je PWA s podporou offline režimu a automatickou synchronizací dat.

## Funkce

- skenování QR kódů hlídek přes ZXing nebo ruční zadání kódu,
- lokální fronta hlídek uložená v IndexedDB (`localforage`) s automatickým retry a ručním dohledem,
- formulář pro zápis bodů, čekání, penalizace za čas a poznámky,
- automatické vyhodnocení terčových odpovědí s možností editace správných odpovědí (admin režim),
- přehled posledních výsledků včetně Realtime aktualizací a exportu do XLSX,
- samostatná obrazovka výsledkového přehledu (scoreboard) načtená přes parametr `?view=vysledky` nebo alias `/vysledky`.

## Požadavky

- Node.js 20 a npm
- Supabase projekt se schématem popsaným ve složce [`supabase/sql`](../supabase/sql)
- Běžící backend (Express API z adresáře [`../server`](../server)) nebo zapnutý bypass přihlášení

## Instalace a spuštění

```bash
npm install
npm run dev
```

Vývojový server Vite se spustí na `http://localhost:5173/` (port může být jiný podle konfigurace).

### Proměnné prostředí

Vytvoř soubor `.env.local` (nebo `.env`) s minimálně těmito klíči:

| Proměnná | Význam |
| --- | --- |
| `VITE_SUPABASE_URL` | URL Supabase instance (např. `https://example.supabase.co`). |
| `VITE_SUPABASE_ANON_KEY` | Anon klíč Supabase pro veřejný klient. |
| `VITE_EVENT_ID` | UUID aktuální akce – filtruje data v databázi a Realtime kanálech. |
| `VITE_STATION_ID` | UUID stanoviště, které se po přihlášení předvyplní. |
| `VITE_AUTH_API_URL` | URL Express backendu pro přihlášení (`/auth/login`, `/manifest`). Volitelné při bypass režimu. |
| `VITE_AUTH_BYPASS` | Hodnota `1` přeskočí přihlášení a dovolí ruční výběr stanoviště (jen pro lokální vývoj). |
| `VITE_ADMIN_MODE` | Hodnota `1` zapne administrátorské nástroje (správa správných odpovědí, zobrazení terčových výsledků). |
| `VITE_SANITY_PROJECT_ID` | ID Sanity projektu pro veřejné stránky. |
| `VITE_SANITY_DATASET` | Název datasetu Sanity (např. `production`). |
| `VITE_SANITY_API_VERSION` | API verze Sanity (např. `2024-06-01`). |

Pro serverless fotogalerii (Vercel funkce) přidej do environmentu také:

| Proměnná | Význam |
| --- | --- |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | E-mail service accountu s přístupem do Drive. |
| `GOOGLE_PRIVATE_KEY` | Privátní klíč service accountu (s `\\n` místo nových řádků). |

Další proměnné (`VITE_STATION_PRESET`, `VITE_SCOREBOARD_REFRESH_MS`, …) lze doplnit dle potřeby – viz `src/config.ts`.

### Build & testy

- `npm run build` – produkční build (výstup `dist/`).
- `npm run preview` – lokální náhled produkčního buildu.
- `npm run lint` – kontrola ESLint.
- `npm run test` – Vitest scénáře v `src/__tests__/`. Testy pokrývají tok offline fronty i automatické skórování terče.
- `npm run test:load` – krátký spike test submit pipeline proti lokální Supabase.
- `npm run test:soak` – dlouhý soak/endurance test (ručně, mimo CI).

### Load & soak testy

Soak test simuluje dlouhý běh (standardně 12h), loguje metriky každou minutu a ukládá report do `test-results/`.
Reporty jsou ve formátu JSON + CSV a mají název `soak-report-<timestamp>.*`.

Příklad spuštění (1h proti lokální Supabase Edge Function):

```bash
SUPABASE_URL=http://127.0.0.1:54321 \
SUPABASE_JWT_SECRET=super-secret-jwt-token-with-at-least-32-characters-long \
SOAK_DURATION_MINUTES=60 \
SOAK_CLIENTS=30 \
TARGET_URL=http://127.0.0.1:54321/functions/v1/submit-station-record \
npm run test:soak
```

Pro testování celé /api vrstvy nastav `TARGET_URL` na `/api/submit-station-record` a ujisti se, že server má
nastavené `JWT_SECRET` a `REFRESH_TOKEN_SECRET`.

#### Recommended defaults

Profil 1: ZÁVOD (realistické, vhodné spustit noc před akcí)

- Cíl: simulace reálného provozu + běžné mobilní výpadky, bez extrémního trápení.
- Pass criteria (informativní, neblokující): error rate typicky < 0.5%, p95 typicky < 800–1200 ms (lokál), bez duplicit/invariant failu.

Copy/paste:

```bash
SOAK_DURATION_MINUTES=720 SOAK_CLIENTS=30 \
SOAK_MIN_INTERVAL_MS=45000 SOAK_MAX_INTERVAL_MS=120000 \
SOAK_RETRY_RATE=0.05 SOAK_RELOAD_RATE=0.01 \
CHAOS_TIMEOUT_RATE=0.02 CHAOS_TIMEOUT_MS=5000 \
CHAOS_429_RATE=0.01 CHAOS_JITTER_MS_MAX=1000 \
CHAOS_BURST_EVERY_MINUTES=30 DB_CHECK_EVERY_UNIQUE_SUCCESSES=300 \
pnpm -C web test:soak
```

Profil 2: TORTURE MODE (agresivní, krátké běhy 15–60 min)

- Cíl: vyvolat thundering herd, retry bouře, timeouts a ověřit, že invarianty drží.
- Pass criteria (striktní): žádné duplicity / invariant fail = MUST. Error rate může být vyšší (např. až 5–10%)
  kvůli simulovaným timeoutům/429, ale retry/backoff nesmí způsobit runaway.

Copy/paste:

```bash
SOAK_DURATION_MINUTES=60 SOAK_CLIENTS=60 \
SOAK_MIN_INTERVAL_MS=5000 SOAK_MAX_INTERVAL_MS=15000 \
SOAK_RETRY_RATE=0.20 SOAK_RELOAD_RATE=0.05 \
CHAOS_TIMEOUT_RATE=0.10 CHAOS_TIMEOUT_MS=2500 \
CHAOS_429_RATE=0.10 CHAOS_JITTER_MS_MAX=3000 \
CHAOS_BURST_EVERY_MINUTES=5 DB_CHECK_EVERY_UNIQUE_SUCCESSES=100 \
pnpm -C web test:soak
```

Poznámky:

- Lokální latence/p95 se liší podle stroje; klíčové je “žádné duplicity” a stabilní chování retry/backoff.
- ZÁVOD profil je ideální spouštět přes noc a ráno zkontrolovat JSON/CSV report.
- TORTURE profil spouštěj krátce (15–60 min), protože je záměrně agresivní.

## Struktura kódu

- `src/App.tsx` – hlavní router a layout rozhraní rozhodčího.
- `src/features/` – doménové moduly (fronta hlídek, scoring, target, výsledkový přehled).
- `src/services/` – integrace na Supabase (Realtime, RPC, storage).
- `src/storage/` – lokální úložiště (`localforage`, `localStorage`). Funkce `appendScanRecord` ukládá historii skenů; aktuálně chybí UI pro její zobrazení.
- `src/__tests__/` – Vitest scénáře simulující práci stanoviště.

## Distribuce

Produkční build se nasazuje na Vercel (viz CI workflow `deploy-vercel.yml`). Výsledek je PWA se service workerem (`src/sw.ts`) a manifestem v `public/`.

## Známé mezery

- Historie skenů uložená přes `src/storage/scanHistory.ts` nemá uživatelské rozhraní – zvaž doplnění panelu s posledními skeny.
- Dokumentace nasazení scoreboardu na externí displej je jen v uživatelském manuálu; uvítala by stručný checklist v repozitáři.
