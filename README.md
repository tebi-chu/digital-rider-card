# Digital Rider Card

NFCタグから個人ごとのデジタル名刺を表示するWebアプリです。

## Production architecture

- Frontend: GitHub Pages (`web/`)
- API and administration: Google Apps Script
- Source of truth: Google Sheets
- Profile images: Google Drive

The repository contains application source only. Profile records, PIN values,
credentials, administrator identifiers, and personal images must not be stored
in GitHub.

## Deployment

Pushes to `main` deploy `web/` through `.github/workflows/pages.yml`.
Google Apps Script is deployed separately from
`integrations/google-apps-script/` and configured through Script Properties.

Required Script Properties:

- `ADMIN_EMAIL`
- `PUBLIC_CARD_BASE_URL`
- `PIN_PEPPER` (created automatically when the first PIN is set)
- `IMAGE_FOLDER_ID` (created automatically on the first image upload)

Legacy migration properties such as `SYNC_SECRET` should be removed after the
ChatGPT Sites deployment is retired.
