# Codex Handover: LGE Creative Hub (Streamlit)

## Purpose
Streamlit-based "Creative Hub | Airtable Access Request" portal using Airtable as system of record and SMTP for email notifications.

## Production URL
- https://lge-banner-airtable-requests.streamlit.app

## GitHub Repo
- https://github.com/digitalproductionsquad-design/creativehub.git

Key files:
- `streamlit_app.py` (UI + routing)
- `streamlit_backend.py` (Airtable client/store, SMTP mailer, OTP helpers, exports)

## Security / Access Control
- App access: Streamlit Cloud `Sharing` (allowed emails / private or restricted)
- Portal password gate: disabled in Cloud via `DISABLE_PORTAL_PASSWORD="true"`
- Admin: `Admin Email + ADMIN_PASSWORD + OTP (TOTP)`
- Admin OTP secret is stored per-admin in Airtable `AdminUsers` field `OTP Secret` (exact spelling/case, includes space).

## Required Streamlit Cloud Secrets (keys only)
Open Streamlit Cloud -> App -> Settings -> Secrets.

### Airtable
- `AIRTABLE_BASE_ID`
- `AIRTABLE_API_KEY`
- `AIRTABLE_TABLE_REQUESTS` (default `Requests`)
- `AIRTABLE_TABLE_ACTIVE_ACCESS` (default `ActiveAccess`)
- `AIRTABLE_TABLE_REFERENCE` (default `ReferenceHierarchy`)
- `AIRTABLE_TABLE_ADMINS` (default `AdminUsers`)
- `AIRTABLE_TABLE_SETTINGS` (default `AdminSettings`)
- `AIRTABLE_TABLE_DELETED_REQUESTS` (default `DeletedRequests`)
- `AIRTABLE_TABLE_DELETED_ACTIVE_ACCESS` (default `DeletedActiveAccess`)
- `AIRTABLE_TABLE_ACCESS_OTP` (default `AccessOtp`)
- `AIRTABLE_TABLE_LOGIN_AUDIT` (default `LoginAudit`)

### SMTP (Gmail recommended)
- `SMTP_HOST="smtp.gmail.com"`
- `SMTP_PORT="587"`
- `SMTP_SECURE="false"`
- `SMTP_USER`
- `SMTP_PASS` (must be Google App Password; normal password will fail)
- `SMTP_FROM`

### Admin
- `ADMIN_PASSWORD`

Optional:
- `ADMIN_TOTP_SECRET` (global fallback TOTP secret; per-admin Airtable secret is preferred)

### App behavior / branding
- `DISABLE_PORTAL_PASSWORD="true"` (use Streamlit Cloud access control instead of shared portal password)
- `PUBLIC_BASE_URL="https://lge-banner-airtable-requests.streamlit.app"` (used for email logo/link)

## Airtable Schema Notes (critical)
### AdminUsers
Must contain:
- `Email`
- `Role` (optional but used for display)
- `OTP Secret` (TOTP base32 secret; field name must be exactly `OTP Secret`)

### ReferenceHierarchy
Used for New Request selectors:
- `Region`
- `Branch` (country/name; user selects this)
- `Subsidiary` (code; auto-mapped)

New Request UX is implemented as:
- `Region` -> `Branch` -> `Subsidiary (Auto)`

## Local Run
```bash
cd "/Users/janghyuk.suh/Documents/New project_streamlit"
python3 -m pip install -r requirements.txt
python3 -m streamlit run streamlit_app.py
```

Local env:
- `.env` is loaded by backend (gitignored).
- `.env.example` shows required keys.

## Ops Checklist
1. App loads (no portal password prompt in Cloud).
2. Admin login:
   - Admin Email + `ADMIN_PASSWORD` + OTP code.
3. Admin -> `Check Airtable Access` shows OK for all tables.
4. New Request:
   - Branch selection auto-fills Subsidiary code.
   - Submit creates Airtable record and sends emails.
5. Admin:
   - Requests and Active Access use row-level `Edit/Notify/Delete` dialogs.
   - Notify sends branded HTML emails.

## Common Failure Modes
- Email fails with `535 5.7.8 BadCredentials`:
  - `SMTP_USER/SMTP_PASS` mismatch or not using Gmail App Password.
- Airtable 401/404:
  - PAT permissions missing or table name mismatch in Secrets.

## Recent Changes Summary
- URL token persistence removed (security). Use Streamlit Cloud Sharing + optional cookie/session only.
- Per-admin OTP mapping via Airtable `AdminUsers.OTP Secret`.
- HTML email template upgraded to match branded design.
- Admin UI refactor: tabs, exports, connection check, row-action dialogs.
- New Request: spinner + status dialog, and Branch-first selection with Subsidiary auto-mapping.

