# Uživatelský manuál – Setonův závod - aplikace

Tento dokument popisuje aktuální chování webové aplikace pro rozhodčí
stanovišť Setonova závodu a samostatný výsledkový přehled (scoreboard). Cílem je poskytnout
praktický návod pro provoz na stanovišti i pro kancelář závodu.

## 1. Přístup a přihlášení

1. Otevři `/aplikace/setonuv-zavod` (nasazená instance může mít i vlastní doménu;
   kratší alias `/setonuv-zavod` je také podporovaný).
   Aplikace běží jako PWA a po prvním načtení funguje i bez připojení.
2. Zadej e-mail a heslo rozhodčího. Přístupové údaje spravuje hlavní rozhodčí.
3. Volitelně můžeš při přihlášení nastavit vlastní PIN (4–6 číslic). PIN se uloží
   jen lokálně do prohlížeče a umožní zařízení odemknout bez zadávání hesla.
4. Pokud systém vyžaduje změnu hesla, zobrazí se formulář pro zadání nového.
   Po uložení se přihlášení dokončí automaticky.
5. Po úspěšném přihlášení aplikace stáhne manifest (údaje o stanovišti,
   rozhodčím a seznam hlídek) a uloží je lokálně. Při dalším startu lze zařízení
   odemknout zadáním PINu, i když je offline.

## 2. Orientace v rozhraní stanoviště

- Horní lišta zobrazuje informace o stanovišti, rozhodčím a stavu synchronizace.
  Ikona offline fronty indikuje, kolik záznamů čeká na odeslání a kdy proběhne
  další pokus.
- Tlačítko **Odhlásit se** zruší lokální data a vrátí aplikaci na přihlašovací
  obrazovku.
- Notifikace se objevují v horní části hlavního sloupce a po několika sekundách
  mizí.

## 3. Běžný pracovní postup na stanovišti

1. **Příprava hlídky**
   - Naskenuj QR kód hlídky vestavěným skenerem nebo zadej kód ručně.
   - Pokud QR kód chybí, aplikace přiřadí dočasný kód `TMP-###`, který se uloží
     jen pro aktuální relaci.
   - Po naskenování se hlídka zobrazí v hlavičce formuláře, načte se její
     kategorie a otevře se formulář.

2. **Fronta hlídek**
   - Skenovanou hlídku můžeš přidat do fronty tlačítkem *Přidat do fronty*.
   - Fronta má tři stavy: **Čekají**, **Obsluhované** a **Hotové**. Přepínání mezi
     stavy slouží k evidenci čekacích dob a pořadí.
   - Fronta se ukládá lokálně pro každé zařízení. Tlačítkem *Resetovat frontu*
     ji lze vymazat (např. při změně směny).

3. **Vyplnění formuláře**
   - **Čas příjezdu / čekací doba**: stanoviště eviduje čas naskenování a podle
     fronty umí předvyplnit čekání. Hodnotu lze ručně upravit.
   - **Body**: pro běžná stanoviště zadej ručně 0–12 bodů. Pro terčový úsek
     aktivuj automatické hodnocení (viz níže).
   - **Poznámka**: libovolný text pro kancelář nebo rozhodčí.
   - **Čas doběhu**: stanoviště „T“ zobrazuje kalkulačku času – zadej čas doběhu
     ve formátu HH:MM, aplikace dopočítá čistý čas po odečtení čekání a body za
     rychlost podle kategorie.

4. **Terčový úsek**
   - Při zapnutém automatickém hodnocení zadej odpovědi ve formátu `A B C …`.
     Aplikace kontroluje správný počet (12) a automaticky spočítá body.
   - Administrátoři mohou v panelu *Správné odpovědi* aktualizovat klíče pro
     jednotlivé kategorie. Změny se uloží do Supabase.

5. **Uložení záznamu**
   - Klikni na **Uložit záznam**. Při úspěchu se zobrazí potvrzení a formulář se
     resetuje.
   - Pokud je zařízení offline, záznam se uloží do lokální fronty. Banner „Čeká
     na odeslání“ ukazuje stav, počet pokusů a poslední chybu. Tlačítkem
     **Odeslat nyní** lze synchronizaci vyvolat ručně.

6. **Kontrola výsledků**
   - Sekce *Kontrola bodů stanovišť* zobrazuje body hlídky ze všech stanovišť.
     Po odškrtnutí „OK“ je řádek potvrzen; v případě potřeby lze hodnotu upravit
     a uložit přímo do Supabase.
   - *Poslední výsledky* načítají streamovaná data ze Supabase – vhodné pro
     rychlou kontrolu, zda se záznam skutečně propsal.

## 4. Offline režim

- Aplikace funguje i bez připojení; všechny formuláře, fronta hlídek i seznam
  hlídek zůstávají dostupné.
- Odesílání probíhá na pozadí. Pokud selže, u záznamu se zobrazí poslední chyba
  a čas dalšího pokusu. Po obnovení připojení systém synchronizaci spustí
  automaticky.
- Offline data jsou vázána na konkrétní prohlížeč a stanoviště. Po odhlášení se
  fronta i PIN odstraní.

## 5. Výsledky (kancelář)

1. Otevři `/aplikace/setonuv-zavod/vysledky` (nebo přidej `?view=vysledky` za hlavní URL;
   starší parametr `?view=scoreboard` nadále funguje).
2. Stránka zobrazí název závodu, čas poslední aktualizace a tabulky pro každou
   kategorii (N/M/S/R × H/D). Zobrazeny jsou celkové body, body bez trestů a
   čistý čas.
3. Data se obnovují automaticky každých 30 sekund. Tlačítko **Aktualizovat**
   vyvolá načtení okamžitě.
4. Kliknutím na **Exportovat Excel** stáhneš XLSX soubor se samostatným listem
   pro každou kategorii, včetně pořadí a čísel hlídek.

## 6. Řešení potíží

- **Nejde se přihlásit** – zkontroluj internetové připojení a správnost hesla.
  Po více neúspěšných pokusech požádej správce o reset hesla.
- **Aplikace vyžaduje PIN** – byl nastaven při přihlášení. Pokud ho neznáš,
  odhlaš zařízení (tlačítko „Odhlásit se“) a přihlas se znovu heslem.
- **Hlídka se nenajde** – ověř, že QR kód je správný. Lze vyhledat i ručně podle
  kódu. Pokud hlídka v manifestu není, kontaktuj kancelář.
- **Záznam se neodeslal** – otevři detail offline fronty, zkontroluj hlášení
  chyby a zkus **Odeslat nyní**. Při opakovaném selhání zkontroluj konfiguraci
  Supabase nebo API.
- **Scoreboard je prázdný** – ověř, že je nastaveno `VITE_EVENT_ID` a že v
  databázi existují data v pohledu `scoreboard_view` (postaveném nad `results`
  a `results_ranked`).

## 7. Další tipy

- Manifest stanoviště se každých pět minut automaticky obnovuje. Pokud se změní
  přiřazení rozhodčího nebo hlídek, promítne se do aplikace bez nutnosti reloadu.
- Číselník hlídek se načítá při startu. Po zásahu kanceláře lze stránku ručně
  načíst znovu (F5) – uložené offline záznamy zůstanou zachovány.
- Při zobrazení na tabletu lze aplikaci přidat na plochu. Prohlížeč pak běží v
  celoobrazovkovém režimu a používá uložený PIN.
