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

Další proměnné (`VITE_STATION_PRESET`, `VITE_SCOREBOARD_REFRESH_MS`, …) lze doplnit dle potřeby – viz `src/config.ts`.

### Build & testy

- `npm run build` – produkční build (výstup `dist/`).
- `npm run preview` – lokální náhled produkčního buildu.
- `npm run lint` – kontrola ESLint.
- `npm run test` – Vitest scénáře v `src/__tests__/`. Testy pokrývají tok offline fronty i automatické skórování terče.

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
