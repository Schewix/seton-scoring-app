# Seton Scoring App (Supabase + Google Sheets)

Systém pro bodování stanovišť Setonu. Projekt začal jako mobilní aplikace v
Expo, ale aktuální vývoj se soustředí na webovou verzi postavenou na Reactu.
Sdílená backendová vrstva běží na Supabase a seznam hlídek se synchronizuje z
Google Sheets. Historická mobilní aplikace už v repozitáři není – toto
monorepo nyní obsahuje jen web, databázové skripty, Google Apps Script a nástroj
pro generování QR kódů.

## Předpoklady

- Node.js 20 (stejná verze se používá v CI a při nasazení na Vercel) a `npm`.
- Přístup k instanci Supabase (URL a anon/service klíče) a případně Supabase
  CLI, pokud budeš lokálně zkoušet SQL skripty.
- Google Apps Script účet s přístupem k tabulce pro import hlídek.

## Přehled repozitáře

- `web/` – webová aplikace pro rozhodčí a výsledkový přehled (React, Vite,
  TypeScript).
- `supabase/sql/` – schéma databáze, pohledy, RLS politiky a referenční seed.
- `google-sheets/` – Apps Script pro import hlídek a popis šablony tabulky.
- `scripts/` – nástroje pro generování QR kódů hlídek.
- `.github/workflows/` – CI/CD workflow pro nasazení webu na Vercel a push
  Supabase schématu.

## Webová aplikace (React + Vite)

### Hlavní funkce

- Skenování QR kódů hlídek kamerou zařízení (ZXing) nebo ruční zadání kódu.
- Formulář pro zápis bodů, čekací doby a poznámky ke stanovišti.
- Automatické vyhodnocení terčového úseku včetně přepínače mezi manuálním a
  automatickým režimem.
- Editace a přehled správných odpovědí pro jednotlivé kategorie včetně tabulky.
- Offline fronta neodeslaných záznamů uložená v IndexedDB (`localforage`) s
  náhledem a ruční synchronizací.
- Přehled posledních výsledků s napojením na Supabase Realtime a detail terče.
- Report terčových odpovědí s exportem do CSV.
- Samostatný výsledkový přehled pro kancelář postavený na pohledech Supabase
  `results` a `results_ranked` (stačí přidat `?view=scoreboard` do URL).

### Instalace a spuštění

1. Nastav prostředí:

   ```bash
   cd web
   npm install
   ```

2. Vytvoř soubor `.env` (nebo `.env.local`) s proměnnými:

   ```bash
   VITE_SUPABASE_URL=<url z projektu Supabase>
   VITE_SUPABASE_ANON_KEY=<anon klíč>
   VITE_EVENT_ID=<UUID aktuální akce>
   VITE_STATION_ID=<UUID stanoviště>
   # volitelné: zapne administrátorský režim pro editaci správných odpovědí
   VITE_ADMIN_MODE=1
   ```

3. Spusť vývojový server:

   ```bash
   npm run dev
   ```

   Pro produkci použij `npm run build` a `npm run preview` nebo nasazení podle
   hostingu.

4. Spusť lint a testy (Vitest) dle potřeby:

   ```bash
   npm run lint
   npm run test
   ```

   Test `stationFlow.test.tsx` kontroluje offline frontu a náhled čekajících
   záznamů.

### Výsledkový přehled (scoreboard)

- Stejné prostředí (`.env`) jako pro rozhodčí – je potřeba především
  `VITE_EVENT_ID`.
- Při spuštění aplikace přidej do URL parametr `?view=scoreboard`. Dynamicky se
  načte stránka s tabulkami z pohledů `results` a `results_ranked`.
- Stránka se automaticky obnovuje každých 30 sekund, případně lze použít ruční
  tlačítko „Aktualizovat“.

### Další poznámky

- Offline fronta je per prohlížeč/stanici – při ztrátě sítě se záznamy ukládají
  lokálně a po kliknutí na „Odeslat nyní“ (nebo po návratu připojení)
  synchronizují.
- Zadané jméno rozhodčího se ukládá do `localStorage` pro další relaci.
- Správné odpovědi lze hromadně upravit v horním panelu (vyžaduje administrátorský
  režim). Při zapnutí automatického hodnocení se odpovědi validují (12 otázek,
  pouze písmena A–D).

## Supabase & Google Sheets

1. Spusť SQL skripty ze složky [`supabase/sql/`](./supabase/sql):

   ```bash
   schema.sql
   views.sql
   rls.sql # zapni RLS jen pokud je potřeba
   ```

   V databázi vzniknou tabulky `station_passages`, `station_scores`,
   `station_category_answers`, `station_quiz_responses` a pohledy `results`,
   `results_ranked`. RLS politiky očekávají, že JWT obsahuje `event_id` a
   `station_id` jako textové hodnoty UUID.

2. Apps Script v [`google-sheets/AppsScript.gs`](./google-sheets/AppsScript.gs)
   synchronizuje listy Google Sheets do tabulky `patrols`. Ve Script Properties
   nastav `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE` a `EVENT_ID`. Šablonu listů
   popisuje soubor
   [`SHEET_TEMPLATE_INFO.md`](./google-sheets/SHEET_TEMPLATE_INFO.md). Skript
   také nabízí funkci `exportResultsToSheets`, která načte pohled
   `results_ranked` a naplní listy `Výsledky N/M/S/R` pořadím včetně celkových
   bodů, bodů bez trestů a členů hlídek. Export lze spouštět ručně z menu
   „Seton → Exportovat výsledky“ nebo přes časovač Apps Scriptu.
   Pokud nechceš používat Apps Script, stejnou synchronizaci zvládne Edge Function
   [`sync-patrols`](./supabase/functions/sync-patrols) – stačí publikovat
   jednotlivé listy jako CSV (`File → Share → Publish to web`) a odkazy předat
   do proměnné `SHEET_EXPORTS` (např. `N_H=https://...`). Funkci pak spouštíš
   přes Supabase cron nebo externí plánovač.

3. Soubor
   [`supabase/sql/seton_2024_seed.sql`](./supabase/sql/seton_2024_seed.sql)
   slouží jako referenční seed dat. Před spuštěním nahraď `EVENT_ID` vlastním
   UUID.

## QR kódy

Skript [`scripts/generate-qr-codes.mjs`](./scripts/generate-qr-codes.mjs)
načte aktivní hlídky z Supabase a vygeneruje pro každou SVG i společné PDF.

1. Nainstaluj závislosti skriptu:

   ```bash
   cd scripts
   npm install
   ```

2. Spusť generování (výstupní složka je volitelná, výchozí je
   `qr-codes/<EVENT_ID>`):

   ```bash
   SUPABASE_URL=... \
   SUPABASE_SERVICE_ROLE_KEY=... \
   node generate-qr-codes.mjs <EVENT_ID> [output-dir]
   ```

   Do QR kódu se vkládá payload `seton://p/<patrol_code>` a stejný kód se
   zobrazí i pod QR kódem vygenerovaného SVG.

## CI/CD a nasazení

- `.github/workflows/deploy-vercel.yml` buildí složku `web/` a nasazuje ji na
  Vercel při pushi do `main`. Workflow očekává sekrety `VERCEL_ORG_ID`,
  `VERCEL_PROJECT_ID` a `VERCEL_TOKEN`.
- `.github/workflows/supabase.yml` propojuje repozitář se Supabase projektem a
  spouští `supabase db push && supabase db seed`. Nastav sekrety
  `SUPABASE_ACCESS_TOKEN` a `SUPABASE_DB_PASSWORD`.

## Terčový úsek

- Pro každou kategorii nastav 12 správných odpovědí (`A/B/C/D`).
- Při zapnutém automatickém hodnocení aplikace porovná odpovědi, spočítá body a
  uloží detail (`station_quiz_responses`).
- Přepnutí zpět na manuální hodnocení odstraní dříve uložené terčové odpovědi
  dané hlídky.

## Známá omezení

- Offline režim se stará pouze o zápis záznamů; načítání dat stále vyžaduje
  připojení.
- Pro ostrý provoz je nutné zajistit správné JWT tokeny (s `event_id` a
  `station_id`) dle definovaných RLS politik.

## Next Steps

1. Připravit bezpečné vydávání JWT tokenů pro rozhodčí (např. přes Supabase Edge
   Functions nebo externí službu) a popsat proces v dokumentaci.
2. Rozšířit testy o automatické hodnocení terče a synchronizaci fronty, aby
   pokryly klíčové větve komunikace se Supabase.
3. Doplnit detailní dokumentaci k archivní mobilní aplikaci, pokud ji bude
   potřeba znovu oživit.
