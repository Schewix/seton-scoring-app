# Seton Scoring App

Seton Scoring App je monorepo pro zapisování výsledků stanovišť závodu Setonův závod. Současná generace projektu běží kompletně ve webovém prohlížeči; backend je postavený na Supabase a malé Express aplikaci, pomocné skripty řeší synchronizaci hlídek a generování QR kódů. Dřívější mobilní klient už není součástí repozitáře.

## Rychlý start

1. **Node.js 20** – celý monorepo používá Node 20 (stejná verze jako v CI). V kořenové složce není potřeba spouštět `npm install`; vždy se pracuje uvnitř konkrétního balíčku (`web/`, `server/`, `scripts/`).
2. **Supabase projekt** – připrav si URL instance, anon/service role klíče a heslo databáze. Schéma a pohledy najdeš v [`supabase/sql`](./supabase/sql).
3. **Google Sheets** – hlídky se synchronizují přes Apps Script nebo Supabase Edge Function. Viz [Google Sheets složku](./google-sheets) a funkci [`sync-patrols`](./supabase/functions/sync-patrols).
4. **Spuštění backendu** – Express API v [`server/`](./server) obsluhuje přihlášení a manifest stanoviště. Stačí vytvořit `.env` podle ukázky níže a spustit `npm run dev`.
5. **Spuštění webu** – klient pro rozhodčí i výsledkový přehled je v [`web/`](./web). Po nastavení `.env.local` stačí `npm run dev` a otevřít URL z terminálu.

> Detailní postupy jsou popsány níže a v README jednotlivých složek.

## Struktura repozitáře

| Složka | Popis |
| --- | --- |
| [`web/`](./web) | React + Vite aplikace pro rozhodčí a veřejný výsledkový přehled (PWA, offline fronta, Vitest testy). |
| [`server/`](./server) | Express API zajišťující přihlášení rozhodčích, vydávání JWT tokenů a manifest stanoviště. |
| [`supabase/sql`](./supabase/sql) | SQL skripty se schématem, pohledy, RLS politikami a referenčním seedem pro konkrétní ročník. |
| [`supabase/functions/sync-patrols`](./supabase/functions/sync-patrols) | Edge Function, která nahrazuje Apps Script synchronizaci hlídek z Google Sheets. |
| [`google-sheets/`](./google-sheets) | Google Apps Script a popis struktury sdílené tabulky pro kancelář. |
| [`scripts/`](./scripts) | Utility (např. generátor QR kódů hlídek). |
| [`docs/`](./docs) | Uživatelský manuál a doplňující podklady pro obsluhu stanovišť. |
| [`notes/`](./notes) | Neformální poznámky a stav dlouhodobých úkolů. |

## Backend (Express API)

Mini-server v adresáři [`server/`](./server) ověřuje přihlášení rozhodčích, vydává krátkodobé access tokeny a spravuje refresh tokeny v tabulce `judge_sessions`. Ve výchozím stavu poskytuje dva endpointy:

- `POST /auth/login` – očekává email a heslo rozhodčího, načte jeho přiřazení (`station_assignments`), vytvoří session a vrátí access i refresh token plus manifest stanoviště.
- `GET /manifest` – ověří access token a vrátí aktuální manifest včetně přiřazených hlídek.

Lokální spuštění:

```bash
cd server
npm install
npm run dev
```

`.env` soubor vypadá takto:

```bash
SUPABASE_URL=https://<projekt>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service role>
JWT_SECRET=<tajný klíč pro access token>
REFRESH_TOKEN_SECRET=<tajný klíč pro refresh token>
# volitelné (sekundy)
ACCESS_TOKEN_TTL_SECONDS=900
REFRESH_TOKEN_TTL_SECONDS=1209600
```

Hotový TypeScript build vytvoří `npm run build`, produkční start zajišťuje `npm start`.

## Webová aplikace (React + Vite)

Aplikace v [`web/`](./web) poskytuje dvě hlavní rozhraní – rozhraní rozhodčího na adrese `/setonuv-zavod` a veřejný výsledkový přehled na `/setonuv-zavod/vysledky` (aliasy `/vysledky`, `/scoreboard`, `?view=vysledky`). Mezi klíčové funkce patří:

- skenování QR kódů hlídek (ZXing) a ruční zadávání kódů,
- lokální fronta hlídek v IndexedDB (`localforage`) s automatickou synchronizací,
- zápis bodů, čekacích dob, poznámek a času doběhu včetně výpočtu penalizací,
- automatické vyhodnocení terčových odpovědí s editací správných odpovědí v admin režimu,
- živý přehled posledních výsledků přes Supabase Realtime a export do XLSX.

Instalace a spuštění:

```bash
cd web
npm install
npm run dev
```

Do `.env.local` přidej minimálně tyto proměnné:

```bash
VITE_SUPABASE_URL=https://<projekt>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon klíč>
VITE_EVENT_ID=<UUID aktuální akce>
VITE_STATION_ID=<UUID stanoviště>
# volitelné
VITE_ADMIN_MODE=1
VITE_AUTH_API_URL=https://scoring-backend.example.com
VITE_AUTH_BYPASS=1  # jen pro lokální vývoj bez přihlášení
```

Běžné skripty: `npm run build`, `npm run preview`, `npm run lint`, `npm run test` (Vitest scénáře pokrývají offline frontu i automatické hodnocení terče).

## Supabase & Google Sheets

1. Spusť SQL skripty v pořadí `schema.sql`, `views.sql`, případně `rls.sql` (zapne RLS) a dle potřeby seed [`seton_2024_seed.sql`](./supabase/sql/seton_2024_seed.sql). RLS politiky předpokládají, že JWT obsahuje `event_id` a `station_id` jako textové UUID.
2. Hlídky lze synchronizovat dvěma způsoby:
   - **Apps Script** [`google-sheets/AppsScript.gs`](./google-sheets/AppsScript.gs) – nastav `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE` a `EVENT_ID` v Script Properties; šablonu listů popisuje [`SHEET_TEMPLATE_INFO.md`](./google-sheets/SHEET_TEMPLATE_INFO.md).
   - **Edge Function** [`sync-patrols`](./supabase/functions/sync-patrols) – publikuj jednotlivé listy jako CSV a jejich URL ulož do proměnné `SHEET_EXPORTS`. Funkci spouštěj cronem nebo ručně pomocí `supabase functions invoke`.
3. Skript [`scripts/generate-qr-codes.mjs`](./scripts/generate-qr-codes.mjs) stáhne aktivní hlídky ze Supabase a vytvoří pro ně SVG i PDF s QR kódy. Spouští se příkazem:

   ```bash
   cd scripts
   npm install
   SUPABASE_URL=... \
   SUPABASE_SERVICE_ROLE_KEY=... \
   node generate-qr-codes.mjs <EVENT_ID> [output-dir]
   ```

## CI/CD

- [`deploy-vercel.yml`](./.github/workflows/deploy-vercel.yml) buildí `web/` a nasazuje ji na Vercel. Potřebné sekrety: `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`, `VERCEL_TOKEN`.
- [`supabase.yml`](./.github/workflows/supabase.yml) spouští `supabase db push && supabase db seed`. Vyžaduje `SUPABASE_ACCESS_TOKEN` a `SUPABASE_DB_PASSWORD`.

## Chybějící nebo plánované oblasti

- **Historie skenů na stanovišti:** web ukládá každý QR sken přes `appendScanRecord`, ale chybí rozhraní pro zobrazení/export historie. Doplnění jednoduchého náhledu by usnadnilo diagnostiku chyb skenování.
- **Dokumentace procesů nasazení serveru:** Express backend se nasazuje manuálně; stojí za to doplnit playbook pro produkční provoz (např. Vercel Functions, Fly.io nebo Supabase Edge Functions).
- **Automatizace Supabase migrací:** SQL skripty se spouští ručně. Integrace se Supabase CLI (`supabase db push`) je částečně připravená v CI, ale chybí popsaný lokální workflow.

Podrobnější poznámky a rozpracované nápady jsou v [`notes/`](./notes).
