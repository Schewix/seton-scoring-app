# Stav původních "Next Steps"

## 1. Bezpečné vydávání JWT tokenů pro rozhodčí

- **Aktuální stav:** V adresáři `server/` běží Express API, které při přihlášení zkontroluje heslo rozhodčího, zjistí jeho přiřazení a vydá krátkodobý access token i refresh token. Refresh token se zároveň ukládá do tabulky `judge_sessions` v Supabase, včetně hashované hodnoty a expirace. End-point `/manifest` pak access token ověří a vrátí aktuální manifest stanoviště.
- **Důkaz v repozitáři:**
  - `server/src/auth.ts` zajišťuje ověření hesla, načtení přiřazení, vytvoření session a vrácení obou tokenů v odpovědi login end-pointu a zároveň validuje access token v handleru `/manifest`.
  - `server/src/tokens.ts` generuje a ověřuje JWT tokeny s TTL načtenými z prostředí.

## 2. Testy pro automatické hodnocení terče a synchronizaci offline fronty

- **Aktuální stav:** Vitest scénáře `web/src/__tests__/stationFlow.test.tsx` pokrývají oba případy – automatické skórování terče i chování offline fronty při ukládání, neúspěchu synchronizace a následném flush.
- **Důkaz v repozitáři:**
  - Test `it('automatically scores target answers and saves quiz responses', …)` ověřuje načtení správných odpovědí, vyhodnocení terče a úspěšné vyprázdnění fronty po synchronizaci.
  - Test `it('stores offline submissions with queue preview details', …)` plus další testy ve stejném souboru pokrývají práci s offline frontou a její synchronizaci.

## Nový tip na rozšíření: historie skenů QR kódů na stanovišti

- **Motivace:** Požadavek na doplnění dokumentace ke staré mobilní aplikaci už není relevantní. Při procházení kódu webové aplikace je ale patrné, že každé načtení QR kódu se ukládá do lokální historie (`appendScanRecord`), přesto rozhodčí nemají možnost tato data zobrazit ani vyexportovat. Přidání jednoduchého náhledu posledních skenů by pomohlo při diagnostice chyb a vysvětlování, proč se konkrétní hlídka nenačetla.
- **Důkaz v repozitáři:**
  - `web/src/App.tsx` na několika místech volá `appendScanRecord` při úspěšných i neplatných skenech, takže informace se ukládají do IndexedDB.
  - `web/src/storage/scanHistory.ts` definuje funkce `appendScanRecord` a `getScanHistory`, ale druhá z nich není nikde používána, což naznačuje chybějící uživatelské rozhraní pro zobrazení historie skenů.

### Shrnutí

- Úkol č. 1 je implementovaný v Express serveru, ale README stále zmiňuje potřebu procesu, takže by možná stálo za to dokumentaci aktualizovat.
- Úkol č. 2 lze považovat za splněný díky existujícím e2e-like Vitest scénářům.
- Namísto původní dokumentace k mobilní aplikaci dává smysl doplnit nástroj pro zobrazení historie skenů, který zúročí již uložená data a pomůže rozhodčím s podporou v terénu.
