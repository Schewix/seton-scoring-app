# Seton Scoring App (Supabase + Google Sheets)

# Seton Scoring App (Supabase + Google Sheets)

Systém pro bodování stanovišť Setonu. Projekt původně vznikl jako mobilní aplikace v Expo, nyní ale probíhá převod do webové aplikace postavené na Reactu. Obě aplikace sdílí stejné Supabase backendové API a import hlídek z Google Sheets.

## Webová aplikace (React + Vite)

Webová verze sídlí ve složce [`web/`](./web) a pokrývá celý flow rozhodčího:

- **Skenování QR kódů** hlídek kamerou zařízení (pomocí knihovny ZXing) nebo ruční zadání kódu.
- Formulář pro zápis **bodů**, **čekací doby** a poznámky ke stanovišti.
- Automatické **hodnocení terčového úseku** s vizuálním porovnáním odpovědí a přepínačem mezi manuálním a automatickým hodnocením.
- Editace a přehled **správných odpovědí** pro jednotlivé kategorie včetně přehledové tabulky.
- Offline **fronta neodeslaných záznamů** uložená v IndexedDB (`localforage`) s možností ruční synchronizace.
- Přehled **posledních výsledků** včetně bodů, rozhodčího a detailu terčového testu s automatickou obnovou přes Supabase
  Realtime.

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
   ```

3. Spusť vývojový server:

   ```bash
   npm run dev
   ```

   V produkci použij `npm run build` a `npm run preview` (nebo nasazení na hostingu podle potřeby).

### Poznámky k webové verzi

- Offline fronta je per prohlížeč/stanici – po ztrátě sítě se záznamy ukládají lokálně a po kliknutí na „Odeslat nyní" (nebo po návratu připojení) se synchronizují.
- Zadané jméno rozhodčího se ukládá do `localStorage` pro další relaci.
- Správné odpovědi lze hromadně načíst/opravit přes horní panel. Při přepnutí na automatické hodnocení se odpovědi validují (12 otázek, jen písmena A–D).

## Mobilní aplikace (Expo – legacy)

Původní mobilní verze stále existuje ve složce [`mobile/`](./mobile). Je možné ji použít nebo z ní brát inspiraci při dalším převodu funkcí.

1. Instalace závislostí:

   ```bash
   cd mobile
   npm install
   ```

   Pokud chybí peer závislosti, doinstaluj je přes `npx expo install` (viz komentáře v souboru `mobile/App.js`).

2. Konfiguruj `mobile/app.config.js` (sekce `extra`):
   Pokud chybí peer závislosti, doinstaluj je přes `npx expo install` (viz komentáře v souboru `mobile/App.js`).

2. Konfiguruj `mobile/app.config.js` (sekce `extra`):
   - `EXPO_PUBLIC_SUPABASE_URL`
   - `EXPO_PUBLIC_SUPABASE_ANON_KEY`
   - `EXPO_PUBLIC_EVENT_ID`
   - `EXPO_PUBLIC_STATION_ID`
   - `EXPO_PUBLIC_EVENT_ID`
   - `EXPO_PUBLIC_STATION_ID`

3. Spusť aplikaci:
3. Spusť aplikaci:

   ```bash
   npm start
   ```

## Supabase & Google Sheets

1. **Supabase** – spusť SQL skripty ze složky [`supabase/sql/`](./supabase/sql):
   1. `schema.sql`
   2. `views.sql`
   3. `rls.sql` (pokud potřebuješ zapnout RLS)

   V databázi jsou mimo jiné tabulky `station_passages`, `station_scores`, `station_category_answers` a `station_quiz_responses`. RLS politiky očekávají, že JWT token nese `event_id` a `station_id` jako textové hodnoty UUID.

## Supabase & Google Sheets

1. **Supabase** – spusť SQL skripty ze složky [`supabase/sql/`](./supabase/sql):
   1. `schema.sql`
   2. `views.sql`
   3. `rls.sql` (pokud potřebuješ zapnout RLS)

   V databázi jsou mimo jiné tabulky `station_passages`, `station_scores`, `station_category_answers` a `station_quiz_responses`. RLS politiky očekávají, že JWT token nese `event_id` a `station_id` jako textové hodnoty UUID.

2. **Google Sheets** – ve složce [`google-sheets/`](./google-sheets) najdeš `AppsScript.gs`, který synchronizuje seznam hlídek do Supabase. Ve Script Properties nastav:
2. **Google Sheets** – ve složce [`google-sheets/`](./google-sheets) najdeš `AppsScript.gs`, který synchronizuje seznam hlídek do Supabase. Ve Script Properties nastav:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE` (tajný service role klíč)
   - `EVENT_ID`
   - `SUPABASE_SERVICE_ROLE` (tajný service role klíč)
   - `EVENT_ID`

## QR kód

Každá hlídka má QR kód s payloadem:
Každá hlídka má QR kód s payloadem:

```
seton://p/<patrol_code>
```

### Generování QR kódů pro akci

Ve složce [`scripts/`](./scripts) je k dispozici skript `generate-qr-codes.mjs`, který stáhne všechny aktivní hlídky konkrétní akce ze Supabase a ke každé vytvoří SVG soubor s QR kódem i čitelným kódem hlídky přímo pod ním. Navíc automaticky připraví také společné PDF, kde jsou QR kódy rozmístěny po několika na stránce a samotný QR kód má přibližně 6×6 cm.

1. Nainstaluj závislosti skriptu:

   ```bash
   cd scripts
   npm install
   ```

2. Spusť generování (výstupní složka je volitelná, výchozí je `qr-codes/<EVENT_ID>`):

   ```bash
   SUPABASE_URL=... \
   SUPABASE_SERVICE_ROLE_KEY=... \
   node generate-qr-codes.mjs <EVENT_ID> [output-dir]
   ```

Skript volá REST API Supabase (`patrols`) a pro každý záznam vytvoří soubor pojmenovaný podle kódu hlídky. Do QR kódu vkládá payload `seton://p/<patrol_code>` a v SVG přidá textovou podobu kódu pro případ ručního zadání. Výsledné SVG se ukládají do zvolené složky a společně s nimi vznikne i `qr-codes.pdf`, kde jsou kódy na stránkách formátu A4 automaticky vyskládány do mřížky.

## Terčový úsek

- Pro každou kategorii je potřeba nastavit 12 správných odpovědí (`A/B/C/D`).
- Při zapnutém automatickém hodnocení appka porovná odpovědi, spočítá body a uloží i detail (`station_quiz_responses`).
- Přepnutí zpět na manuální hodnocení automaticky odstraní dříve uložené odpovědi dané hlídky.
- Pro každou kategorii je potřeba nastavit 12 správných odpovědí (`A/B/C/D`).
- Při zapnutém automatickém hodnocení appka porovná odpovědi, spočítá body a uloží i detail (`station_quiz_responses`).
- Přepnutí zpět na manuální hodnocení automaticky odstraní dříve uložené odpovědi dané hlídky.

## Známá omezení

- Offline režim řeší pouze zápis stanovištních záznamů; načítání dat stále vyžaduje připojení.
- Pro ostrý provoz je nutné zajistit správné JWT tokeny (s `event_id` a `station_id`) dle definovaných RLS politik.

## Next Steps

1. Přidat detailní report terčových odpovědí (např. export pro výsledkovou kancelář).
2. Zvážit základní integrační test (např. přes Detox nebo Cypress) pro klíčový flow sken → hodnocení → uložení.
3. Doplnit jednoduchý náhled neodeslaných offline záznamů přímo v UI pro snazší kontrolu.
