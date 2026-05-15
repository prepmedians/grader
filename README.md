# Prepmedians Grader

ACT practice test scoring platform for [grader.prepmedians.com](https://grader.prepmedians.com).

Students upload or manually enter their answer sheet, get a scored report with section scores, category breakdowns, and a personalized study plan. Results are saved to their account and can be emailed as a PDF. Educators have a dashboard with student history and aggregate analytics.

## Stack

| Layer | Technology |
|---|---|
| Frontend | React + Vite, deployed on Netlify |
| Backend | FastAPI (Python), deployed on Railway |
| Database | PostgreSQL on Railway (SQLite locally) |
| OMR pipeline | n8n webhook → OpenCV |
| Email | Resend |
| AI extraction | Anthropic Claude (answer key extraction from PDF) |

## Repo layout

```
grader/
├── App.jsx                     # Main React app (all UI)
├── src/main.jsx                # React entry point
├── actPracticeTest1Scoring.js  # ACT Practice Test 1 answer key + scoring
├── studyRecommendations.js     # Study plan generation
├── studyRecommendationRules.js # Recommendation rule definitions
├── package.json
├── netlify.toml                # Netlify SPA redirect rule
├── railway.toml                # Railway build/start config (root-level)
├── docs/
│   └── Scantron2.json          # n8n workflow definition
└── backend/
    ├── app.py                  # FastAPI routes
    ├── models.py               # SQLAlchemy models (users, scan_results)
    ├── database.py             # DB engine + session (env-driven URL)
    ├── auth_utils.py           # bcrypt + JWT helpers
    ├── pdf_report.py           # ReportLab PDF generation
    ├── requirements.txt
    ├── railway.toml            # Railway config (backend root)
    └── nixpacks.toml           # Nixpacks build config
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
# Leave DATABASE_URL unset to use SQLite locally
# JWT_SECRET defaults to a dev value — override in production
```

On first start the backend creates all tables automatically. SQLite file lives at `backend/data/scantron2.db`.

## Deploy

### Netlify (frontend)

- **Build command:** `npm run build`
- **Publish directory:** `dist`
- **Root directory:** *(repo root)*

Environment variables:

```text
VITE_BACKEND_BASE_URL = https://your-backend.railway.app
```

Custom domain: point `grader.prepmedians.com` → Netlify via CNAME.

### Railway (backend)

- **Root directory:** `backend/`
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
```

Mount a persistent volume at `/app/data` to preserve the SQLite fallback and feedback log across deploys.

### Postgres setup

1. Railway project → **+ New** → **Database** → **PostgreSQL**
2. Backend service → **Variables** → link `DATABASE_URL` from the Postgres service
3. Tables are created automatically on first deploy

## User roles

| Role | Access |
|---|---|
| `student` | Own scan results, history, email PDF |
| `educator` | All student results, analytics dashboard, role management |

First educator: register a normal account, then set role via the API or directly in the DB:
```sql
UPDATE users SET role = 'educator' WHERE username = 'yourname';
```

## Key endpoints

| Method | Path | Description |
|---|---|---|
| POST | `/auth/register` | Create account |
| POST | `/auth/login` | Log in |
| GET | `/auth/me` | Current user |
| POST | `/parse-omr` | Score an answer sheet image |
| POST | `/me/results` | Save results with scores |
| GET | `/me/results` | Student history |
| POST | `/me/email-results` | Generate PDF and email to student |
| GET | `/admin/users` | All users (educator only) |
| GET | `/admin/results` | All results (educator only) |
| GET | `/admin/analytics` | Aggregate stats (educator only) |
| GET | `/health` | Health check |
