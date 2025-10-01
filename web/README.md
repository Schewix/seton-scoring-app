# Seton web app

Tato složka obsahuje webovou aplikaci pro zapisování výsledků stanovišť a
veřejný výsledkový přehled. Projekt je postavený na Reactu, TypeScriptu a Vite
(viz `package.json`).

## Vývoj

```bash
npm install
npm run dev
```

V prostředí se očekávají tyto proměnné (například v `.env.local`):

```bash
VITE_SUPABASE_URL=<url z projektu Supabase>
VITE_SUPABASE_ANON_KEY=<anon klíč>
VITE_EVENT_ID=<UUID aktuální akce>
VITE_STATION_ID=<UUID stanoviště>
# volitelné, zapne administrátorský režim pro editaci správných odpovědí
VITE_ADMIN_MODE=1
```

Spuštěním aplikace s parametrem `?view=scoreboard` v URL se načte výsledkový
přehled, který využívá pohled `scoreboard_view` (stavějící na `results_ranked`).

## Scripts

- `npm run dev` – vývojový server Vite.
- `npm run build` – produkční build.
- `npm run preview` – náhled buildu.
- `npm run lint` – ESLint.
- `npm run test` – Vitest testy (viz `src/__tests__`).

## Další poznámky

- Offline fronta neodeslaných záznamů je uložená v IndexedDB (`localforage`).
- QR kód je možné skenovat přes ZXing nebo zadat ručně.
- Administrátorský režim (`VITE_ADMIN_MODE`) umožňuje spravovat správné odpovědi
  pro terčový úsek.
