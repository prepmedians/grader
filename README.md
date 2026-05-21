# Prepmedians Grader

ACT practice test scoring platform for [grader.prepmedians.com](https://grader.prepmedians.com).

Students sign up with an invite code, upload or manually enter their answer sheet, and get a scored report with section scores, category breakdowns, and a personalized study plan. Results are saved to their account and can be emailed as a PDF. Admins have a unified panel to manage tests, students, results, and invite codes.

## Stack

| Layer | Technology |
|---|---|
| Frontend | React + Vite, deployed on Cloudflare Pages |
| Backend | FastAPI (Python), deployed on Railway (Railpack) |
| Database | PostgreSQL on Railway (SQLite locally) |
| OMR pipeline | n8n webhook + OpenCV |
| Email | Resend |
| AI extraction | Anthropic Claude (answer key extraction from PDF) |

## Repo layout

```
grader/
├── App.jsx                     # Main React app (all UI)
├── src/main.jsx                # React entry point
├── index.html                  # Vite HTML shell (title: Prepmedians Grader)
├── actPracticeTest1Scoring.js  # ACT Practice Test 1 answer key + scoring
├── studyRecommendations.js     # Study plan generation
├── studyRecommendationRules.js # Recommendation rule definitions
├── package.json
├── netlify.toml                # SPA redirect rule (legacy)
├── docs/
│   └── Scantron2.json          # n8n workflow definition
└── backend/
    ├── app.py                  # FastAPI routes + OMR pipeline
    ├── models.py               # SQLAlchemy models (User, ScanResult, InviteCode)
    ├── database.py             # DB engine + session (env-driven URL)
    ├── auth_utils.py           # bcrypt + JWT helpers
    ├── pdf_report.py           # ReportLab PDF generation
    ├── requirements.txt
    ├── railway.toml            # Railway deploy config
    └── nixpacks.toml           # Nixpacks config (legacy, Railpack is used)
```

## Local development

### Frontend

```bash
npm install
npm run dev
```

Create a `.env.local` file in the repo root:

```text
VITE_BACKEND_BASE_URL=http://localhost:5000
```

### Backend

```bash
cd backend
pip install -r requirements.txt
uvicorn app:app --reload --host 0.0.0.0 --port 5000
```

Create a `.env` file inside `backend/` or export these in your shell:

```text
ANTHROPIC_API_KEY=...
ADMIN_USERNAME=admin
ADMIN_PASSWORD=changeme
PARSE_WEBHOOK_URL=https://your-n8n.cloud/webhook/omr-upload
CORS_ALLOW_ORIGINS=http://localhost:5173
SIGNUP_INVITE_CODE=prep2026
# Leave DATABASE_URL unset to use SQLite locally
# JWT_SECRET defaults to a dev value — override in production
```

On first start the backend creates all tables automatically. SQLite file lives at `backend/data/scantron2.db`.

## Deploy

### Cloudflare Pages (frontend)

- **Build command:** `npm run build`
- **Build output directory:** `dist`
- **Root directory:** *(repo root)*

Environment variables:

```text
VITE_BACKEND_BASE_URL = grader-production.up.railway.app
```

The frontend auto-prepends `https://` if the protocol is missing.

Custom domain: point `grader.prepmedians.com` to Cloudflare Pages.

### Railway (backend)

- **Root directory:** `backend`
- **Builder:** Railpack (auto-detects Python/FastAPI)
- Start command is in `backend/railway.toml` — no manual config needed.

Environment variables:

```text
DATABASE_URL        = postgresql://... (from Railway Postgres plugin)
JWT_SECRET          = <long random string>
ANTHROPIC_API_KEY   = ...
ADMIN_USERNAME      = ...
ADMIN_PASSWORD      = ...
PARSE_WEBHOOK_URL   = https://your-n8n.cloud/webhook/omr-upload
CORS_ALLOW_ORIGINS  = https://grader.prepmedians.com
RESEND_API_KEY      = re_...  (optional — emails log to console if unset)
SIGNUP_INVITE_CODE  = prep2026  (env var fallback — DB codes also accepted)
```

### Postgres setup

1. Railway project > **+ New** > **Database** > **PostgreSQL**
2. Backend service > **Variables** > link `DATABASE_URL` from the Postgres service
3. Tables are created automatically on first deploy (including `invite_codes`)

## Authentication and access

### Landing page

Unauthenticated users see a branded landing page with Sign In and Get Started buttons. After signing in, returning users are taken directly to the grader (30-day session cookie).

### Invite codes

Registration requires a valid invite code. Codes can be:
- Set via the `SIGNUP_INVITE_CODE` environment variable (always accepted)
- Managed from the Admin Panel > Invite Codes tab (stored in the database)

Both sources are checked during registration. If no codes exist (no env var and no DB codes), registration is open.

### User roles

| Role | Access |
|---|---|
| `student` | Own scan results, history, email PDF |
| `educator` | All student results, analytics, role management |

### Admin access

Admins authenticate via HTTP Basic Auth (using `ADMIN_USERNAME` / `ADMIN_PASSWORD`). Admin login is available from the landing page. The Admin Panel has tabs for:

- **Overview** — KPI cards, average scores, scans per week
- **Test Setup** — Upload scoring guides and study-material PDFs
- **Students** — List view with scan counts and role management
- **Results** — Student marks with section score breakdowns
- **Invite Codes** — Add, activate, deactivate, or delete codes

First educator: register an account, then set role via the DB:
```sql
UPDATE users SET role = 'educator' WHERE username = 'yourname';
```

## Key endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/auth/register` | none | Create account (requires invite code) |
| POST | `/auth/login` | none | Log in |
| GET | `/auth/me` | cookie | Current user |
| POST | `/parse-omr` | none | Score an answer sheet image |
| POST | `/me/results` | cookie | Save results with scores |
| GET | `/me/results` | cookie | Student history |
| POST | `/me/email-results` | cookie | Generate PDF and email to student |
| GET | `/admin/users` | cookie (educator) | All users |
| GET | `/admin/results` | cookie (educator) | All results |
| GET | `/admin/analytics` | cookie (educator) | Aggregate stats |
| POST | `/admin/users/:id/role` | cookie (educator) | Change user role |
| GET | `/admin/invite-codes` | Basic Auth | List invite codes |
| POST | `/admin/invite-codes` | Basic Auth | Create invite code |
| PATCH | `/admin/invite-codes/:id` | Basic Auth | Toggle active/inactive |
| DELETE | `/admin/invite-codes/:id` | Basic Auth | Delete invite code |
| GET | `/admin/tests` | Basic Auth | List tests with answer keys |
| POST | `/admin/tests/import-pdf` | Basic Auth | Upload scoring + study PDFs |
| GET | `/tests` | none | List available tests (public) |
| GET | `/health` | none | Health check |
