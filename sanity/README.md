# Sanity Studio

Sanity Studio slouží jako redakční rozhraní pro články, obsah homepage a metadata fotogalerií.

## Rychlý start

```bash
cd sanity
npm install
cp .env.example .env
npm run dev
```

Studio se spustí na `http://localhost:3333`.

### Deploy studio

```bash
cd sanity
npm run deploy
```

## Instrukce pro editory

1. **Přihlášení do Studio** – otevři nasazenou adresu studio (např. `https://<project>.sanity.studio`).
2. **Článek** – v menu zvol `Článek`, vytvoř nový záznam, doplň titulní fotku a text. Ulož jako *Draft* a po kontrole klikni na **Publish**.
3. **Homepage** – v sekci `Homepage` uprav úvodní text a vyber album, které se má ukazovat na titulní stránce.
4. **Album** – v sekci `Album` vyplň název, datum, školní rok a **vložením odkazu nebo ID** složky z Google Drive. Pokud vložíš URL, systém automaticky uloží ID složky. Přepni `Publikovat album` a klikni na **Publish**.

## .env

Použij `SANITY_PROJECT_ID`, `SANITY_DATASET` a `SANITY_API_VERSION` (např. `2024-06-01`).
