# Business Cloud Portal

React + Vite frontend, Node/Express API, Supabase PostgreSQL/Auth.
Designed as a cloud replacement for the supplied business workbook.

## 1. Create services
1. Create a GitHub repository.
2. Create a Supabase project. In SQL Editor run `database/schema.sql`.
3. In Supabase Authentication > Providers, enable Email. Create your first user.
4. In Supabase Project Settings > API, copy Project URL, anon key and service_role key.
5. Create a Render Web Service. **Root Directory: `server`**, Build command: `npm install`; Start command: `npm start`; Health Check Path: `/health`.
6. Set Render environment variables:
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY` (the public anon key; access is protected by RLS)
   - `CLIENT_ORIGIN` = your GitHub Pages URL
   - `PORT` is supplied by Render.
7. In `client/.env.production`, set `VITE_API_URL` to the Render API URL ending in `/api`.
8. Push the repository to GitHub. In GitHub repo Settings > Pages choose GitHub Actions.
9. Add repository variable `VITE_API_URL` with the Render API URL ending in `/api`.
10. Add the workflow `.github/workflows/deploy.yml` and push to `main`.

## 2. Run locally
Terminal 1:
```bash
cd server
npm install
cp .env.example .env
# Fill in Supabase URL and service role key
npm run dev
```
Terminal 2:
```bash
cd client
npm install
cp .env.example .env
# VITE_API_URL=http://localhost:5000/api
npm run dev
```
Open the Vite URL printed in the terminal.

## 3. Important data model
- companies: company master and credit days
- purchases: purchase records
- sales: sales records
- payments: received or paid transactions
- Dashboard totals are calculated from PostgreSQL, not spreadsheet formulas.

## 4. Excel migration
Do not upload the `.xlsm` directly as a public file. First validate and import its rows into the matching tables. Preserve a backup of the original workbook. The current starter app does not automatically import macros, formulas, PivotTables or Power Query logic.

## 5. Security
- The API uses the anon key plus each user's JWT, so Row Level Security (see `database/schema.sql`) enforces ownership.
- Users sign in through Supabase Auth; API verifies the access token.
- Restrict signups in Supabase once your authorized users have been created.
- Configure database backups and test restore before relying on it for accounting.
- This starter is a foundation, not a certified accounting or GST system.
