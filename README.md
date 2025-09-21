# Seton Scoring App (Expo + Supabase + Google Sheets)

Mobilní aplikace pro zapisování bodů na stanovištích (QR sken hlídek), s online ukládáním do **Supabase** a pohodlným importem hlídek z **Google Sheets** (8 listů: `N_H, N_D, M_H, M_D, S_H, S_D, R_H, R_D`).

## Funkce

- Sken **QR kódu** hlídky (payload: `seton://p/<patrol_code>`).
- Zápis **bodů** a **čekací doby** (minuty) pro dané stanoviště.
- Automatické **hodnocení terčového úseku** (multiple-choice test) se správnými odpověďmi pro každou kategorii.
- Uložení online do **Supabase** tabulek `station_passages` a `station_scores`.
- Jednoduchý **výpis posledních záznamů** pro stanoviště.
- **Realtime** aktualizace hlídek (z Sheets → Supabase → appka).
- Připravené **SQL schéma** (včetně `results` a `results_ranked`).

## Rychlý start

1. Vytvoř projekt Expo nebo použij tento:

   ```bash
   cd mobile
   npm install
   ```

   Pokud by chyběly peer závislosti, použij:

   ```bash
   npx expo install expo-barcode-scanner expo-file-system expo-sharing @react-native-async-storage/async-storage
   npm i @supabase/supabase-js @react-native-picker/picker
   ```

2. Nakonfiguruj **env** v `mobile/app.config.js` (sekce `extra`):
   - `EXPO_PUBLIC_SUPABASE_URL`
   - `EXPO_PUBLIC_SUPABASE_ANON_KEY`
   - `EXPO_PUBLIC_EVENT_ID` (UUID akce)
   - `EXPO_PUBLIC_STATION_ID` (UUID tvého stanoviště)

3. Spusť appku:

   ```bash
   npm start
   ```

4. **Supabase**: spusť SQL ze složky `supabase/sql/` (nejdřív `schema.sql`, pak `views.sql`, poté případně `rls.sql`).
   - Nově jsou k dispozici tabulky `station_category_answers` (správné odpovědi dle kategorie) a `station_quiz_responses` (uložené záznamy odpovědí).

5. **Google Sheets**: ve složce `google-sheets/` je `AppsScript.gs` – vlož jej do *Apps Script* projektu v sešitu s 8 listy. V *Script properties* nastav:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE` (tajné!)
   - `EVENT_ID` (UUID akce)

## QR kód

Vytiskni kód s payloadem:

```
seton://p/<patrol_code>
```

## Terčový úsek

- V mobilní appce (horní panel) nastav pro každou kategorii 12 správných odpovědí terčového testu (`A/B/C/D`).
- Při skenování hlídky lze zapnout automatiku „Vyhodnotit terčový úsek“ a jen zapsat zvolené odpovědi.
- Appka sama spočítá body, uloží je do `station_scores` a také uloží detail (`station_quiz_responses`).

**Pozn.:** kód je minimální funkční základ – přizpůsob si vzhled, navigaci a validace dle potřeb.
