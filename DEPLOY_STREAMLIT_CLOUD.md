# Deploy to streamlit.app (Community Cloud)

## What I can/can't do
- I can prepare your project and exact deploy steps.
- I cannot log in to your Google account and click deploy on your behalf.

## 1) Push this folder to GitHub
Streamlit Community Cloud deploys from GitHub.

1. Create a new GitHub repo (private is fine).
2. Push this project folder:

```bash
cd "/Users/janghyuk.suh/Documents/New project_streamlit"
git init
git add .
git commit -m "Streamlit app for Creative Hub"
git branch -M main
git remote add origin <YOUR_GITHUB_REPO_URL>
git push -u origin main
```

## 2) Deploy in Streamlit Cloud
1. Open [https://share.streamlit.io](https://share.streamlit.io)
2. Sign in with your Google account
3. Click `New app`
4. Select your GitHub repo and branch `main`
5. Main file path: `streamlit_app.py`
6. Click `Deploy`

## 3) Add secrets (required)
In Streamlit Cloud:
`App` -> `Settings` -> `Secrets`

Paste keys from `.streamlit/secrets.toml.example` and replace values with your real credentials.

Important:
- `AIRTABLE_BASE_ID` must be `app...`
- `AIRTABLE_API_KEY` must be PAT with access to this base
- table names must match Airtable table names exactly
- SMTP settings must be valid for email automation

## 3.1) Access control (recommended)
Instead of using a shared `SITE_PASSWORD`, use Streamlit Cloud's built-in access control.

1. In Streamlit Cloud, open your app
2. Go to `Settings` -> `Sharing`
3. Set visibility to private (or restricted)
4. Add allowed viewers by email (your company accounts)

Then disable the portal password gate:
- Remove `SITE_PASSWORD` from Secrets (or set it to empty)
or
- Set `DISABLE_PORTAL_PASSWORD=true` in Secrets

## 4) Reboot app
After saving secrets, click `Reboot app`.

## 5) Quick verification
1. Open `New Request`, submit a test request
2. Open `Admin Dashboard`, verify request appears
3. Click `Check Airtable Access`
4. Check email delivery (requester + admin recipients)
