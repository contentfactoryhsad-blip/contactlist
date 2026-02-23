# Access Request App (Streamlit + Airtable + SMTP)

This project is now fully runnable as a Streamlit app with Airtable as the system of record and SMTP for notifications.

## What is included
- New request submission (`New Access`, `Access Update`)
- Duplicate and branch quota checks (`Viewer <= 3`, `Editor <= 2`)
- My Requests lookup by email
- My Access self-service update with OTP verification
- Admin dashboard:
  - request/active-access list, filter, edit, delete
  - completion/deletion/status emails
  - admin settings update
  - Excel exports (`Requests.xlsx`, `ActiveAccess.xlsx`)
- Optional site-level password gate (`SITE_PASSWORD`)

## Requirements
- Python 3.10+
- Airtable Base + Personal Access Token
- SMTP account credentials

## Setup
1. Install Python dependencies:
```bash
pip install -r requirements.txt
```

2. Copy and fill environment variables:
```bash
cp .env.example .env
```

3. Required Airtable environment values:
```env
AIRTABLE_BASE_ID=appXXXXXXXXXXXXXX
AIRTABLE_API_KEY=pat_xxxxxxxxxxxxx
AIRTABLE_TABLE_REQUESTS=Requests
AIRTABLE_TABLE_ACTIVE_ACCESS=ActiveAccess
AIRTABLE_TABLE_REFERENCE=ReferenceHierarchy
AIRTABLE_TABLE_ADMINS=AdminUsers
AIRTABLE_TABLE_SETTINGS=AdminSettings
AIRTABLE_TABLE_DELETED_REQUESTS=DeletedRequests
AIRTABLE_TABLE_DELETED_ACTIVE_ACCESS=DeletedActiveAccess
AIRTABLE_TABLE_ACCESS_OTP=AccessOtp
AIRTABLE_TABLE_LOGIN_AUDIT=LoginAudit
```

4. Required SMTP environment values:
```env
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your_account
SMTP_PASS=your_password_or_app_password
SMTP_FROM=your_sender_email
```

5. Password protection (optional):
```env
ADMIN_PASSWORD=your_admin_password
SITE_PASSWORD=your_site_password
```
`SITE_PASSWORD` is optional. If empty, the app is publicly accessible and only admin actions require `ADMIN_PASSWORD`.

## Run Streamlit
```bash
streamlit run streamlit_app.py
```

## Deploy to streamlit.app
See deployment guide:

```text
DEPLOY_STREAMLIT_CLOUD.md
```

## Existing migration tools (kept)
Node/TypeScript scripts are still available for data migration and Vercel env sync.

Install Node deps when needed:
```bash
npm install
```

Google Sheets -> Airtable migration:
```bash
npm run migrate:airtable -- --upload --replace
```

If your company network injects TLS certificates:
```bash
ALLOW_INSECURE_TLS=1 npm run migrate:airtable -- --upload --replace
```

Sync `.env` to Vercel:
```bash
npm run sync:vercel-env
```

## Notes
- Airtable Base ID must be `app...` format.
- Personal Access Token must include access to the target base.
- Admin notify recipients are line-separated in `AdminSettings` (`Admin Notify Recipients`).
