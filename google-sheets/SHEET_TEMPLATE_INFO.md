# Google Sheets – šablona (8 listů)

Vytvoř si listy s názvy: `N_H, N_D, M_H, M_D, S_H, S_D, R_H, R_D`.

Každý list má hlavičku (řádek 1):
```
team_name | patrol_code | note | active
```
- `team_name` – povinné
- `patrol_code` – může být prázdné (skript vygeneruje unikátní)
- `note` – volitelné
- `active` – „Yes/No“ (neaktivní hlídky se neukazují ve výsledcích)

Aktivuj Apps Script `AppsScript.gs`, nastav Script Properties (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE`, `EVENT_ID`), přidej spouštěč **Při změně** a/nebo časovač (např. každých 5 minut).
