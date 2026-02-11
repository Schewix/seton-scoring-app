# `sync-patrols` Edge Function

Tato Supabase Edge Function nahrazuje historický Google Apps Script. Stahuje CSV exporty z jednotlivých listů Google Sheets (publikovaných přes „Share → Publish to web“), parsuje je a upsertuje hlídky do tabulek `patrols` a `timings`.

Funkce běží v prostředí Deno na Supabase a ke komunikaci s databází používá service-role klíč. Každé volání prochází všechny konfigurované listy a:

1. doplní chybějící `patrol_code` (náhodným 6znakovým kódem),
2. aktualizuje údaje o hlídce (`team_name`, kategorie, poznámka, aktivita),
3. vytvoří/aktualizuje záznam o startu (`timings`) pokud je ve zdroji vyplněný čas.

> Poznámka: Tento README se týká jen Edge Function `sync-patrols`. Kontext celé aplikace a migrací je v root [`README.md`](../../README.md).

## Nasazení

```bash
supabase functions deploy sync-patrols
```

Před nasazením nastav potřebné secret hodnoty:

```bash
supabase secrets set \
  SUPABASE_SERVICE_ROLE_KEY=<service-role-key> \
  SYNC_EVENT_ID=<uuid-of-event> \
  SHEET_EXPORTS=$'N_H=https://...\nN_D=https://...\nM_H=https://...'
```

Volitelně můžeš přidat i `SYNC_SECRET` – pokud je nastavený, funkce očekává hlavičku `Authorization: Bearer <SYNC_SECRET>`.

`SUPABASE_URL` není potřeba zadávat; v prostředí Supabase Functions se doplní automaticky.

## Lokální vývoj

Pro lokální testování si vystačíš se Supabase CLI (vyžaduje Deno):

```bash
SHEET_EXPORTS=$'N_H=https://...\nN_D=https://...' \
SUPABASE_SERVICE_ROLE_KEY=... \
SYNC_EVENT_ID=... \
supabase functions serve --env-file .env.local --no-verify-jwt sync-patrols
```

V `.env.local` můžeš držet shodné hodnoty jako v produkci. Funkce poslouchá na `http://localhost:54321/functions/v1/sync-patrols`.

Manualní spuštění (lokálně i v cloudu) vypadá takto:

```bash
supabase functions invoke sync-patrols --no-verify-jwt \
  --request-body '{}' \
  --header 'Authorization: Bearer <SYNC_SECRET>'
```

Odpověď obsahuje počty zpracovaných záznamů:

```json
{
  "patrols": 128,
  "timings": 64
}
```

## Plánování

Funkci spouštěj cronem každých pár minut – buď přes Supabase Scheduled Functions, nebo externí plánovač. Zdrojové CSV by měly být publikované s volbou „Automatically republish when changes are made“.

## Známá omezení

- Funkce očekává přesný formát záhlaví CSV (viz `index.ts`). Pokud listy obsahují jiné názvy sloupců, volání skončí chybou 400.
- Neprobíhá deduplikace podle jmen dětí; klíčem je kombinace `event_id + patrol_code`. Pokud chceš sloučit hlídku ručně, udělej změny přímo v Supabase.
