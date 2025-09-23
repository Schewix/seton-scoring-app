# Google Sheets – šablona (8 listů)

Vytvoř si listy s názvy: `N_H, N_D, M_H, M_D, S_H, S_D, R_H, R_D`.

Každý list má hlavičku (řádek 1):
```
team_name | patrol_code | child1 | child2 | child3 | start_time | note | active
```
- `team_name` – povinné
- `patrol_code` – může být prázdné (skript vygeneruje unikátní)
- `child1`/`child2`/`child3` – jména členů hlídky (volitelné, zobrazují se ve výsledcích)
- `start_time` – čas startu (volitelné, ukládá se do tabulky `timings`)
- `note` – libovolná poznámka k hlídce (volitelné)
- `active` – „Yes/No“ (neaktivní hlídky se neukazují ve výsledcích)

Aktivuj Apps Script `AppsScript.gs`, nastav Script Properties (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE`, `EVENT_ID`), přidej spouštěč **Při změně** a/nebo časovač (např. každých 5 minut).
