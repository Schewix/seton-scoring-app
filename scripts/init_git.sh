#!/usr/bin/env bash
set -euo pipefail
git init
git config user.name "Seton Bot"
git config user.email "seton-bot@example.com"

git add .
git commit -m "init: repo skeleton, README, license"

git add mobile
git commit -m "mobile: minimal Expo app skeleton"

git add mobile/src/supabase.js mobile/App.js mobile/src/screens/ScanAndScoreScreen.js
git commit -m "mobile: Supabase client, QR scan & station scoring"

git add mobile/src/components/LastScoresList.js
git commit -m "mobile: recent scores list & basic preferences storage"

git add supabase/sql/schema.sql
git commit -m "supabase: schema (enums, patrols, stations, passages, scores, timings)"

git add supabase/sql/views.sql
git commit -m "supabase: results & results_ranked views"

git add google-sheets/AppsScript.gs
git commit -m "google-sheets: 8-sheet Apps Script sync to Supabase"

git add google-sheets/SHEET_TEMPLATE_INFO.md
git commit -m "docs: sheet template & tips"
