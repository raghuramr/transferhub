# Deploying the BU Transfer Credit Evaluation app

Three pieces, three places:

| Piece | Platform | Why |
|---|---|---|
| UI (`src/ui`) | **Vercel** | Static Vite build, free, perfect fit |
| API (`src/api`) | **Render** (or Railway) | Persistent Node process — Vercel's serverless functions don't suit this app's connection pooling |
| Database | **Azure SQL Database** | It's the same engine your schema is written for (stored procs, `MERGE`, `ISJSON`, `NEWSEQUENTIALID`) — zero SQL changes needed |

Do them in this order: **database → API → UI**, since the API needs the DB connection string and the UI needs the API's URL.

---

## 1. Azure SQL Database

### Create the server + database
1. [portal.azure.com](https://portal.azure.com) → **Create a resource** → **SQL Database**.
2. Create a new **SQL server** (the logical server) if you don't have one — pick a region, set an **admin login** and **password** (you'll need these for `DB_USER`/`DB_PASSWORD`).
3. Database name: `CreditEvalManager`.
4. Compute + storage: pick the **free offer** tier if available in your subscription (Azure periodically offers a free Azure SQL DB — 100,000 vCore-seconds/month, 32GB storage), otherwise the cheapest **Serverless** tier (General Purpose, auto-pause enabled) is fine for a demo.
5. Under **Networking**, set **"Allow Azure services and resources to access this server"** — and also add a firewall rule allowing your current IP so you can run the migrations from your machine. (Render's outbound IPs aren't static on the free plan — for a hackathon demo it's common to temporarily allow `0.0.0.0`–`255.255.255.255` under Networking → Firewall rules; it's protected by the SQL login regardless. Tighten this later with Render's static-IP add-on if this goes beyond a demo.)
6. Create. Note the server hostname: `<yourserver>.database.windows.net`.

### Run the migrations
**Important:** Azure SQL Database doesn't allow `USE <otherdb>` mid-connection, so skip `migrations/001_database.sql` (the database already exists as its own Azure resource) and connect **directly to `CreditEvalManager`** for everything else. The migrations and seed files are consolidated one-file-per-entity (see `CLAUDE.md` and `database/README.md`) — run them in filename order:

```bash
# From the database/ folder, using sqlcmd (or Azure Data Studio / SSMS if you prefer a GUI)
sqlcmd -S "<yourserver>.database.windows.net" -d CreditEvalManager -U <admin-login> -P "<password>" -N -i migrations/002_auth_and_roles.sql
sqlcmd -S "<yourserver>.database.windows.net" -d CreditEvalManager -U <admin-login> -P "<password>" -N -i migrations/003_institutions_courses_programs.sql
sqlcmd -S "<yourserver>.database.windows.net" -d CreditEvalManager -U <admin-login> -P "<password>" -N -i migrations/004_transcripts_and_evaluations.sql
sqlcmd -S "<yourserver>.database.windows.net" -d CreditEvalManager -U <admin-login> -P "<password>" -N -i migrations/005_views_and_procedures.sql
sqlcmd -S "<yourserver>.database.windows.net" -d CreditEvalManager -U <admin-login> -P "<password>" -N -i migrations/006_pages.sql
sqlcmd -S "<yourserver>.database.windows.net" -d CreditEvalManager -U <admin-login> -P "<password>" -N -i migrations/007_forms.sql
sqlcmd -S "<yourserver>.database.windows.net" -d CreditEvalManager -U <admin-login> -P "<password>" -N -i migrations/008_universities_institutions_agencies.sql
sqlcmd -S "<yourserver>.database.windows.net" -d CreditEvalManager -U <admin-login> -P "<password>" -N -i migrations/009_course_topics.sql
sqlcmd -S "<yourserver>.database.windows.net" -d CreditEvalManager -U <admin-login> -P "<password>" -N -i migrations/010_uploads.sql

# Seed data
sqlcmd -S "<yourserver>.database.windows.net" -d CreditEvalManager -U <admin-login> -P "<password>" -N -i seed/001_reference_data.sql
sqlcmd -S "<yourserver>.database.windows.net" -d CreditEvalManager -U <admin-login> -P "<password>" -N -i seed/002_courses_and_equivalencies.sql
sqlcmd -S "<yourserver>.database.windows.net" -d CreditEvalManager -U <admin-login> -P "<password>" -N -i seed/003_demo_users.sql
sqlcmd -S "<yourserver>.database.windows.net" -d CreditEvalManager -U <admin-login> -P "<password>" -N -i seed/004_pages.sql
sqlcmd -S "<yourserver>.database.windows.net" -d CreditEvalManager -U <admin-login> -P "<password>" -N -i seed/005_forms.sql
sqlcmd -S "<yourserver>.database.windows.net" -d CreditEvalManager -U <admin-login> -P "<password>" -N -i seed/006_agencies_academicunits_programs.sql
sqlcmd -S "<yourserver>.database.windows.net" -d CreditEvalManager -U <admin-login> -P "<password>" -N -i seed/007_course_topics.sql
sqlcmd -S "<yourserver>.database.windows.net" -d CreditEvalManager -U <admin-login> -P "<password>" -N -i seed/008_roles_permissions.sql
```

Prefer running these through `tools/db-script-runner/` (the GUI script runner) instead of calling `sqlcmd` one file at a time by hand — it lists every script with Applied/Not Applied status and runs a batch in filename order. Note: an already-deployed database that ran the old (pre-consolidation) migration/seed files will show these new files as "Not Applied" the first time the runner points at it — that's expected, not an error; every new file is idempotent, so running it is a safe no-op wherever the schema/data already matches.
(`-N` enables encryption, required by Azure SQL.)

If `sqlcmd` isn't installed locally, use [Azure Data Studio](https://learn.microsoft.com/en-us/azure-data-studio/download-azure-data-studio) instead — connect to the server, open each `.sql` file, run in order.

---

## 2. API → Render

1. Push this repo to GitHub (already done) and go to [dashboard.render.com](https://dashboard.render.com) → **New** → **Blueprint**.
2. Point it at this repo — Render will read `render.yaml` at the repo root and create the `um-api` web service with `rootDir: src/api` already configured.
3. Render will prompt for every env var marked `sync: false` in `render.yaml`. Fill them in:

| Key | Value |
|---|---|
| `DB_SERVER` | `<yourserver>.database.windows.net` |
| `DB_USER` | your Azure SQL admin login |
| `DB_PASSWORD` | your Azure SQL admin password |
| `JWT_SECRET` | a real random secret (`node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"`) |
| `ANTHROPIC_API_KEY` | your real Anthropic API key |
| `CORS_ORIGIN` | leave as a placeholder for now (e.g. `https://placeholder.vercel.app`) — update once you have your real Vercel URL in step 3 |

4. Deploy. Once live, note the API's URL, e.g. `https://um-api.onrender.com`.
5. Confirm it's healthy: `curl https://um-api.onrender.com/api/health` → `{"status":"ok",...}`.
6. Run `npm run seed:users` **once**, pointed at the deployed DB, to set real argon2id password hashes for the demo accounts (run this from your own machine with `.env` pointed at the Azure SQL connection — see `src/api/.env.production` as a template, or export the same vars as shell env vars before running `npm run seed:users`).

---

## 3. UI → Vercel

1. [vercel.com](https://vercel.com) → **Add New** → **Project** → import this repo.
2. Set **Root Directory** to `src/ui` (Vercel auto-detects the Vite framework once you do).
3. Add one environment variable:

| Key | Value |
|---|---|
| `VITE_API_URL` | `https://um-api.onrender.com/api` (your Render API URL + `/api`) |

4. Deploy. Vercel gives you a URL like `https://your-app.vercel.app`.
5. Go back to Render → `um-api` → Environment → set `CORS_ORIGIN` to that exact Vercel URL (no trailing slash) → redeploy the API so CORS allows it.

---

## 4. Smoke test

1. Open the Vercel URL — you should see the public hero landing page.
2. Click **Log in**, sign in as `admin@bu.edu` / `Admin@123!` (after running `seed:users` against the deployed DB).
3. Check **Admin → Course Database** loads real courses (confirms the API ↔ Azure SQL connection is healthy).
4. Check **Admin → Custom Pages** and **Custom Forms** load (confirms the newer tables migrated correctly).

---

## Notes

- **Render free tier** spins the service down after ~15 minutes idle; the first request after that takes ~30-60s to cold-start. Fine for a demo, not for anything latency-sensitive — upgrade the plan if that matters.
- **Azure SQL free/serverless tier** also auto-pauses after inactivity; the first query after a pause adds a few seconds of latency while it resumes.
- Never commit real values for `DB_PASSWORD`, `JWT_SECRET`, or `ANTHROPIC_API_KEY` — they belong only in Render's/Vercel's environment variable settings, consistent with `.gitignore` already excluding local `.env` files.
