# App Handover (2026-02-12)

## 1) Current repository status
- Workspace: `/Users/janghyuk.suh/Documents/New project`
- Git: initialized, but **no commits yet** (`main` has zero commits)
- App source is present and buildable.

## 2) What this app is
A Next.js 14 TypeScript portal for Airtable access operations with Google Sheets as the active backend.

Main user flows:
1. New access request submission
2. My request status lookup by email
3. My active access lookup + OTP-verified self-update
4. Admin dashboard for request/access management + exports + notifications
5. Optional full-site password gate

## 3) Core stack
- Next.js 14 (App Router), React 18, TypeScript
- Google Sheets API (`googleapis`) as source of truth
- Email notifications via SMTP (`nodemailer`)
- Excel import/export via `xlsx`

Key files:
- `/Users/janghyuk.suh/Documents/New project/package.json`
- `/Users/janghyuk.suh/Documents/New project/README.md`
- `/Users/janghyuk.suh/Documents/New project/.env.example`

## 4) Main screens
- Home: `/Users/janghyuk.suh/Documents/New project/app/page.tsx`
- New Request: `/Users/janghyuk.suh/Documents/New project/app/request/page.tsx`
- My Requests: `/Users/janghyuk.suh/Documents/New project/app/my-requests/page.tsx`
- Access Review (OTP update): `/Users/janghyuk.suh/Documents/New project/app/my-access/page.tsx`
- Admin: `/Users/janghyuk.suh/Documents/New project/app/admin/page.tsx`
- Site Login: `/Users/janghyuk.suh/Documents/New project/app/site-login/page.tsx`

UI components:
- `/Users/janghyuk.suh/Documents/New project/components/RequestForm.tsx`
- `/Users/janghyuk.suh/Documents/New project/components/MyRequests.tsx`
- `/Users/janghyuk.suh/Documents/New project/components/MyAccess.tsx`
- `/Users/janghyuk.suh/Documents/New project/components/AdminDashboard.tsx`
- `/Users/janghyuk.suh/Documents/New project/components/NavBar.tsx`

## 5) Backend/API map
Public/user endpoints:
- `POST /api/requests`: create request (new access + access update payload support)
- `GET /api/me/requests?email=`: my requests
- `GET /api/me/access?query=`: search active access records
- `POST /api/me/access/otp`: send verification code
- `POST /api/me/access/verify`: verify code and update access record
- `GET /api/reference/hierarchy`: region/subsidiary/branch options
- `GET /api/public/settings`: expose central admin contact email

Admin endpoints (all require `x-admin-password`):
- `GET /api/admin/requests`
- `PATCH/DELETE /api/admin/requests/:id`
- `POST /api/admin/requests/:id/notify`
- `GET /api/admin/active-access`
- `PATCH/DELETE /api/admin/active-access/:id`
- `GET/PUT /api/admin/settings`
- `GET /api/admin/export/requests.xlsx`
- `GET /api/admin/export/active-access.xlsx`

Site-password endpoint:
- `POST /api/site-login`

Files:
- `/Users/janghyuk.suh/Documents/New project/app/api/**`

## 6) Data model (Google Sheets tabs)
Defined in `/Users/janghyuk.suh/Documents/New project/lib/sheets.ts`:
- `Requests`
- `ActiveAccess`
- `ReferenceHierarchy`
- `AdminUsers`
- `AdminSettings`
- `DeletedRequests`
- `DeletedActiveAccess`
- `AccessOtp`
- `LoginAudit`

Notable rules:
- Quota: Viewer 3, Editor 2 (`/Users/janghyuk.suh/Documents/New project/lib/quota.ts`)
- Duplicate prevention on active/pending requests
- OTP: 6 digits, 150 seconds TTL, max-attempt tracking
- Request/active deletions are archived to deleted tabs with reason

## 7) Email behavior
SMTP-based notifications in `/Users/janghyuk.suh/Documents/New project/lib/email.ts`:
- Submission
- Completion
- Deletion
- Manual status update
- OTP verification code

Branding assets:
- `/Users/janghyuk.suh/Documents/New project/public/email-logo.png`
- `/Users/janghyuk.suh/Documents/New project/public/lg-logo.png`
- `/Users/janghyuk.suh/Documents/New project/public/lg-logo-full.png`

## 8) Site-wide auth gate
- Middleware: `/Users/janghyuk.suh/Documents/New project/middleware.ts`
- Password/token helpers: `/Users/janghyuk.suh/Documents/New project/lib/siteAuth.ts`
- If `SITE_PASSWORD` exists, all routes except static/internal/login are gated
- Successful login sets `site_auth` cookie (24h)
- Login attempts are logged to `LoginAudit`

## 9) Setup and utility scripts
- Create Google Sheet skeleton:
  - `/Users/janghyuk.suh/Documents/New project/scripts/setup_google_sheet.ts`
- Seed hierarchy/active access from Excel:
  - `/Users/janghyuk.suh/Documents/New project/scripts/seed_from_excel.ts`
- SharePoint list bootstrap (optional/legacy path):
  - `/Users/janghyuk.suh/Documents/New project/scripts/setup_sharepoint.ts`
- Outlook inbox summary Python script:
  - `/Users/janghyuk.suh/Documents/New project/scripts/outlook_inbox_summary.py`

## 10) Recovery/history files found
- `/Users/janghyuk.suh/Documents/New project/recovery/thread-recovery-2026-02-04.txt`
- `/Users/janghyuk.suh/Documents/New project/recovery/thread-recovery-2026-02-10.txt` (empty)
- `/Users/janghyuk.suh/Documents/New project/recovery/thread-recovery-2026-02-12.txt`

## 11) Validation run (today)
- `npm run build`: success (Next.js production build completed)
- `npm run lint`: blocked by interactive first-time ESLint setup prompt

## 12) Important operational note
This project is currently vulnerable to future “history loss” because Git has no commits yet.

Recommended immediate action:
1. Make initial commit now
2. Push to remote (GitHub/GitLab)
3. Continue work on top of versioned history

---

## Update: Airtable migration prep (2026-02-12)
- Added Airtable-first data layer and backend switcher:
  - `/Users/janghyuk.suh/Documents/New project/lib/airtable.ts`
  - `/Users/janghyuk.suh/Documents/New project/lib/store.ts`
- App API and business logic imports moved from `@/lib/sheets` to `@/lib/store`.
- Added migration script:
  - `/Users/janghyuk.suh/Documents/New project/scripts/migrate_sheets_to_airtable.ts`
- Added npm command:
  - `npm run migrate:airtable`
- Added Airtable env keys to:
  - `/Users/janghyuk.suh/Documents/New project/.env.example`
- Updated docs:
  - `/Users/janghyuk.suh/Documents/New project/README.md`

Migration commands:
1. Dry run: `npm run migrate:airtable`
2. Upload: `npm run migrate:airtable -- --upload`
3. Replace target tables then upload: `npm run migrate:airtable -- --upload --replace`
