# Outlook Inbox Summary (Device Code)

This project uses Microsoft Graph with device code flow to read your Outlook inbox.

## Prerequisites
- Microsoft 365 work account
- App registration in Microsoft Entra

## App registration checklist
1. Create an app registration.
2. Account type: Single tenant (recommended for work orgs).
3. Add API permissions (delegated): `Mail.Read`, `User.Read`.
4. No redirect URI needed for device code flow.
5. Copy the Application (client) ID and your Directory (tenant) ID.

## Environment
Set these environment variables before running the script:
- `MS_GRAPH_CLIENT_ID` (required)
- `MS_GRAPH_TENANT_ID` (optional; defaults to `organizations`)

## Install dependencies
```
pip install -r requirements.txt
```

## Run
```
python scripts/outlook_inbox_summary.py
```

The first run prints a device code message. Follow it to sign in once. A token cache is stored in `.auth/`.
