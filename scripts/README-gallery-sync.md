# Google Drive -> Cloudflare R2 Gallery Sync

Google Drive zustava zdroj fotek. Tento sync bere stejnou strukturu a stejny filtr jako soucasna webova galerie: root slozka, v ni slozky kalendarnich roku, pod nimi slozky akci/alb a v nich fotky. Fotky muzou byt primo v albu i ve vnorenejsich podslozkach. Stahne alba, ktera by web zobrazil podle `GOOGLE_DRIVE_ALBUM_NAME_ALLOWLIST`, vytvori WebP full image a thumbnail a nahraje je do Cloudflare R2 bucketu `zelena-liga-gallery`.

## 1. Google Drive pristup

Pro verejne sdilene Google Drive slozky neni service account povinny. Slozka i fotky musi byt citelne pro
kazdeho s odkazem. Google Drive API ale i pro verejne slozky vyzaduje identitu volajiciho, proto nastav
`GOOGLE_DRIVE_API_KEY`:

1. V Google Cloud Console vytvor nebo vyber projekt.
2. Zapni API `Google Drive API`.
3. V `APIs & Services -> Credentials` vytvor API key.
4. API key uloz do `GOOGLE_DRIVE_API_KEY`.

Pro soukrome nebo omezene slozky pouzij service account:

1. V Google Cloud Console vytvor nebo vyber projekt.
2. Zapni API `Google Drive API`.
3. V `IAM & Admin -> Service Accounts` vytvor service account.
4. V detailu service accountu vytvor JSON key.
5. JSON uloz lokalne mimo git, napr. `zelena-liga-sa.json`, nebo jeho obsah vloz do `GOOGLE_SERVICE_ACCOUNT_JSON`.

## 2. Sdileni Google Drive slozky

1. V Google Drive otevri root slozku fotogalerie.
2. Pro public rezim nastav sdileni na **Anyone with the link / Viewer**.
3. Pro service account rezim v JSON klici najdi `client_email` a sdilej root slozku na tento e-mail s opravnenim `Viewer`.
4. Z URL root slozky zkopiruj folder ID do `GOOGLE_DRIVE_ROOT_FOLDER_ID`.

## 3. Cloudflare R2

1. V Cloudflare vytvor R2 bucket `zelena-liga-gallery`.
2. V `R2 -> Manage R2 API Tokens` vytvor API token s opravnenim cist a zapisovat do bucketu.
3. Nastav public access nebo custom/public domain pro bucket.
4. Do env nastav `CLOUDFLARE_R2_PUBLIC_BASE_URL` na verejnou base URL bucketu.

## 4. Environment

Vytvor `scripts/.env` podle `scripts/.env.example`:

```bash
GOOGLE_SERVICE_ACCOUNT_JSON=
GOOGLE_DRIVE_API_KEY=...
GOOGLE_DRIVE_SCRIPT_URL=
GOOGLE_DRIVE_ROOT_FOLDER_ID=...
GOOGLE_DRIVE_LIST_CORPORA=allDrives
GOOGLE_DRIVE_ALBUM_NAME_ALLOWLIST="setonuv zavod, reset, draci smycka, ringobal, memorial bedricha stolicky, sraz pto, deskovky, za psem, lakros, karakoram, piotrio, brnenske bloudeni, vybijena, zabijena, draci smycky, pioples, ples pp"
GOOGLE_DRIVE_DOWNLOAD_DELAY_MS=250
GOOGLE_DRIVE_DOWNLOAD_RETRIES=3
GOOGLE_DRIVE_DOWNLOAD_RETRY_DELAY_MS=5000
GOOGLE_DRIVE_DOWNLOAD_MAX_RETRY_DELAY_MS=60000
CLOUDFLARE_R2_ACCOUNT_ID=...
CLOUDFLARE_R2_ACCESS_KEY_ID=...
CLOUDFLARE_R2_SECRET_ACCESS_KEY=...
CLOUDFLARE_R2_BUCKET=zelena-liga-gallery
CLOUDFLARE_R2_PUBLIC_BASE_URL=https://gallery.example.com
GALLERY_R2_ROOT_PREFIX=
GALLERY_R2_INDEX_PATH=index.json
```

`GOOGLE_SERVICE_ACCOUNT_JSON` muze byt raw JSON, base64 JSON, nebo cesta k JSON souboru. Pro verejny Drive muze zustat prazdne.
`GOOGLE_DRIVE_API_KEY` nastav pro verejny Drive misto service accountu.
`GOOGLE_DRIVE_SCRIPT_URL` je volitelny fallback na puvodni Apps Script galerii. Pokud je nastaveny, sync pouzije Apps Script pro listovani slozek a fotek, coz pomaha u Drive struktur, kde API key nebo service account vidi slozku, ale nevidi jeji obsah.
`GOOGLE_DRIVE_LIST_CORPORA` ve vychozim stavu pouziva `allDrives`, aby sync nasel i soubory ve verejnych slozkach, shortcut targetech a sdilenych discich. Pokud mas nastaveny konkretni `GOOGLE_DRIVE_SHARED_DRIVE_ID`, sync pouzije `corpora=drive` pro tento drive.
`GOOGLE_DRIVE_ALBUM_NAME_ALLOWLIST` funguje stejne jako ve webu: prazdna hodnota znamena vsechna prima alba pod rokem, jinak se album zobrazi/synchronizuje, pokud jeho nazev nebo cesta pod rokem obsahuje nektery vyraz. GitHub Actions workflow ma vychozi allowlist pro hlavni souteze; GitHub variable se stejnym nazvem ho muze prepsat.
`GOOGLE_DRIVE_DOWNLOAD_*` promene zpomaluji downloady a opakuji docasne chyby z Google Drive, typicky `rateLimitExceeded`, `userRateLimitExceeded`, HTTP 429 a HTTP 5xx. Pokud Google vrati tvrdy limit typu `dailyLimitExceeded`, `downloadQuotaExceeded` nebo chybejici opravneni, script chybu vypise a fotku preskoci.

## 5. Konfigurace galerii

Ve vychozim rezimu neni nutny zadny config soubor. Pokud existuje `GOOGLE_DRIVE_ROOT_FOLDER_ID`, script automaticky projde webovou galerii.
Alba muze najit i hloubeji pod rocnikem, napr. `rok -> akce -> podslozky -> fotky`. Pokud je vybrana slozka akce, sync do ni zahrne i fotky z jejich podslozek.
Pokud jsou ve stejnem roce dve slozky se stejnym nebo velmi podobnym nazvem akce, sync je slouci do jednoho alba. Pri porovnani ignoruje rok, datum, uvodni cislo a slova jako `fotky` nebo `foto`.

Volitelne lze zkopirovat `scripts/gallery-sync.config.example.json` na `scripts/gallery-sync.config.json` a omezit roky nebo prepsat allowlist:

```json
{
  "source": "web-gallery",
  "rootFolderId": "google-drive-root-folder-id",
  "targetRootPrefix": "",
  "albumAllowlist": [
    "zelena liga",
    "draci smycka"
  ],
  "years": [
    "2026"
  ]
}
```

V R2 vznikne struktura:

```text
index.json
2026/nazev-akce/full/nazev-fotky.webp
2026/nazev-akce/thumb/nazev-fotky.webp
2026/nazev-akce/manifest.json
```

Manifest obsahuje `fullPath`, `fullUrl`, `thumbPath`, `thumbUrl`, puvodni nazev, velikosti, rozmery, rok a slug alba.
Korenovy `index.json` obsahuje seznam alb, pocty fotek, nahledy a cestu k manifestu kazdeho alba. Web ho pouziva pro vypis fotogalerie bez dotazu do Google Drive.

Pro specialni jednorazovy sync konkretni slozky lze stale pouzit explicitni seznam:

```json
{
  "galleries": [
    {
      "name": "Setonuv zavod 2026",
      "driveFolderId": "google-drive-folder-id",
      "driveFolderIds": ["google-drive-folder-id", "second-google-drive-folder-id"],
      "prefix": "2026/setonuv-zavod/"
    }
  ]
}
```

## 6. Spusteni

```bash
cd scripts
npm install
npm run gallery:sync
```

S jinym configem:

```bash
npm run gallery:sync -- --config ./gallery-sync.config.json
```

Vynucene pregenerovani a prepsani objektu:

```bash
npm run gallery:sync:force
```

Script je idempotentni: pokud full i thumb objekt v R2 existuje a manifest obsahuje odpovidajici fotku, bez `--force` je preskoci.

## 7. GitHub Actions

Sync lze spustit rucne v GitHubu:

1. Otevri **Actions**.
2. Vyber workflow **Gallery Sync**.
3. Klikni **Run workflow**.
4. Pokud chces pregenerovat i existujici fotky v R2, zapni volbu `force`.

Workflow pouziva GitHub Secrets `CLOUDFLARE_R2_ACCESS_KEY_ID` a `CLOUDFLARE_R2_SECRET_ACCESS_KEY`.
Pro soukromy Drive pridej take `GOOGLE_SERVICE_ACCOUNT_JSON`. Pro verejny Drive pridej
`GOOGLE_DRIVE_API_KEY`. Ostatni konfiguraci cte z GitHub Actions Variables.

## 8. Napojeni webu

Po prvnim syncu nastav ve Vercelu pro web:

```bash
GALLERY_SOURCE=r2
CLOUDFLARE_R2_PUBLIC_BASE_URL=https://gallery.example.com
GALLERY_R2_INDEX_PATH=index.json
```

`GALLERY_SOURCE=r2` znamena, ze `/api/gallery` cte pouze Cloudflare R2 manifesty. Pokud `GALLERY_SOURCE` neni nastavene nebo je `auto`, API zkusi R2 pri dostupne public base URL a pri chybe spadne zpet na Google Drive. Pro puvodni rezim nastav `GALLERY_SOURCE=drive`.
