# Intros

Find out who your clients should introduce you to.

Add a client company and its people. Intros reads who each of them follows and who follows them on LinkedIn, X and Instagram, rates everyone against what you are looking for ("founders and business owners in marketing"), and shows the best matches with the person at the client who can make the introduction.

## Quick start

You need Node 22 or newer and Docker.

```bash
cp .env.example .env          # then add your treg and OpenRouter keys (see below)
docker compose up -d          # Postgres on :5433 and an S3 emulator on :9090
npm install
npm run db:migrate            # tables and row-level security
npm run dev                   # http://localhost:3000
```

Open the app, add a client (a name and a website), and press **Find connections**. The first visit creates your workspace; nothing needs seeding.

Two keys switch the paid features on. Without them the app still runs, but cannot look anyone up or rate anyone.

| Key                  | Used for                                              | Get it                                 |
| -------------------- | ----------------------------------------------------- | -------------------------------------- |
| `TREG_API_KEY`       | Finding people, accounts, follower lists and profiles | [treg.to](https://treg.to)             |
| `OPENROUTER_API_KEY` | Rating people against a search, picking accounts      | [openrouter.ai](https://openrouter.ai) |

## Configuration

All settings are environment variables. `.env.example` lists them with working local values.

| Variable                                   | Default                 | Meaning                                                                    |
| ------------------------------------------ | ----------------------- | -------------------------------------------------------------------------- |
| `DATABASE_URL`                             | local `intros_app`      | The app's connection. Must be a role that cannot bypass row-level security |
| `MIGRATION_DATABASE_URL`                   | `DATABASE_URL`          | The owner role, used only by `npm run db:migrate`                          |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`    | local emulator          | Object storage for raw API responses. The bucket must already exist        |
| `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | `test`                  | Storage credentials                                                        |
| `S3_FORCE_PATH_STYLE`                      | `true`                  | `true` for the emulator, `false` for Cloudflare R2 and S3                  |
| `TREG_API_KEY`, `TREG_BASE_URL`            | none, `https://treg.to` | Empty turns off every paid lookup                                          |
| `OPENROUTER_API_KEY`                       | none                    | Empty turns search off                                                     |
| `OPENROUTER_MODEL`                         | `openai/gpt-4o-mini`    | Model that reads people                                                    |
| `OPENROUTER_AGENT_MODEL`                   | `OPENROUTER_MODEL`      | Stronger model for the review agent. Must support tool calling             |
| `APP_TENANT_SLUG`, `APP_TENANT_NAME`       | `default`, `My team`    | The workspace the app shows. Created on first visit                        |
| `APP_PASSWORD`                             | none                    | Password for the whole app. Required in production                         |

Search, the budget for fetching profiles, countries to include or exclude, and which networks to read are set in the app, under **Settings**.

## Commands

| Command                      | Does                                                                  |
| ---------------------------- | --------------------------------------------------------------------- |
| `npm run dev`                | Development server                                                    |
| `npm run build`, `npm start` | Production build and server                                           |
| `npm run db:migrate`         | Apply migrations and row-level security. Safe to run again            |
| `npm run db:generate`        | Write a migration after changing `src/db/schema`                      |
| `npm run verify`             | Typecheck, lint, format check and tests: what CI runs                 |
| `npm test`                   | Unit tests (no network, no database)                                  |
| `npm run eval`               | Check search quality against the real model. Needs a key, costs cents |
| `npm run format`             | Format everything with Prettier                                       |

## Deploying

The app is one Next.js server plus Postgres and an S3-compatible bucket.

1. **Postgres 16.** Create two roles: an owner that runs migrations, and a restricted `NOSUPERUSER NOBYPASSRLS` role for the app. [`docker/postgres/init.sql`](docker/postgres/init.sql) shows the grants. Superusers skip row-level security, so the app must never connect as the owner.
2. **Bucket.** Create it in R2 or S3 and set the `S3_*` variables.
3. **Image.** `docker build -t intros .` makes the production image.
4. **Migrate.** `docker run --rm --env-file .env intros npm run db:migrate`, with `MIGRATION_DATABASE_URL` set to the owner role.
5. **Run.** `docker run -p 3000:3000 --env-file .env intros`. Set `APP_PASSWORD`: in production the app answers 503 until it is set, because every search spends money. Browsers ask for it with the standard sign-in box (any username).

`GET /api/health` returns 200 when the database is reachable. It needs no password, so load balancers can use it.

There are no user accounts, only the one shared password and one workspace. Put the app behind your own login (a proxy or a VPN) if more is needed.

## How it works

A **client** is a company. Its **employees** are people. An employee's **network** is everyone they follow or who follows them. A **search** rates every person in every employee's network and ranks the results.

### Adding people

- **Client:** a name and a website. **Find connections** then asks treg for the company's people (up to 20 by domain).
- **Person:** only a name is needed. For each network turned on in Settings and not yet filled in, the app searches by name and company. A search returns many strangers, so the model is shown each result next to who we want and keeps an account only when it is clearly the same person; when unsure it saves nothing. A lookup that found nothing is remembered, so repeat clicks do not pay again. Add or fix an account by hand with the pencil on the person's page.
- **Handles everywhere:** accounts are stored and shown as handles (`jane`, `jane-doe`), never as full URLs.

### Reading networks

`src/clients/social.ts`, one treg tool per list:

| Network   | treg tool                                                            | Gives                               |
| --------- | -------------------------------------------------------------------- | ----------------------------------- |
| X         | `tikhub.x.twitter-web-fetch-user-followers` / `-followings`          | both lists, bios, ~$0.001 a page    |
| Instagram | `tikhub.x.instagram-v2-fetch-user-followers` / `-following`          | both lists, no bios, ~$0.002 a page |
| LinkedIn  | `harvestapi.linkedin.profile.search` with `followerOf=<profile URL>` | followers only, ~$0.002 a page      |

- Two accounts that follow each other know each other. On X and Instagram the overlap of the two lists becomes `mutual` ties (strength 0.8). Settings can also keep one-way follows (0.4). LinkedIn gives followers only, always one-way (0.35).
- Instagram lists give a handle and a name, so each new contact's profile is opened (~$0.001, up to 100 per import) for their bio, website and size.
- X and Instagram ties are replaced on each read, so re-running is safe. LinkedIn only returns a sample of followers, so each read adds to what is there.
- One employee's read stops at $1.00 and 30 pages. Every call is recorded with its cost; raw responses are kept in the bucket.

Limits: a mutual follow is only found when both accounts fall inside the per-list cap (Settings, up to 2000). Accounts on different networks are not merged into one person.

### Searching

`src/clients/finder.ts`. No keyword matching anywhere: a model reads every person.

1. **Pool.** One entry per person in any employee's network, with every path to them (`pool.ts`). People inside the client are left out.
2. **Countries.** Settings can block countries or allow only some. The model turns each person's listed place into a country code once, and people ruled out are dropped before anyone is rated, so they cost nothing. A blocked country always wins; people with no place are kept by a blocklist and hidden by an allowlist.
3. **Interpret.** One model call turns the search words into a brief (who it is for, what must be true, what rules someone out), saved so every batch is judged by the same reading.
4. **Read.** The model rates every person from the facts held (title, company, industry, place, bio, experience, skills): a score from 0 to 100, how sure it is, and one sentence why. Batches of 25 run four at a time, up to 200 people a request, and the browser asks again until none are pending. Ratings are saved per search and per version of the facts, so repeats are instant.
5. **Review.** An agent (`src/intelligence/agent.ts`) looks again at the best 40. It can fetch a full LinkedIn profile for a promising person who rests on thin facts, within the profile budget from Settings (default $0.10, at most $1, enforced in code), and submits final scores. Model usage is not part of that budget.
6. **Rank.** Rank is 75% fit plus 25% warmth (the strongest tie). **Ask for intro** at 0.7 or more with warmth of at least 0.3, **Maybe** from 0.4, otherwise **Skip**.

**Get more detail** on the top picks (or one person) shows the cost first, then fetches full LinkedIn profiles (~$0.0015 each) and rates those people again.

Search needs `OPENROUTER_API_KEY`. Without it the page says so and the search box is disabled; there is no keyword fallback.

## Project layout

```
app/              Next.js pages and the /api route
  api/[...path]/  one handler that calls src/web/api.ts
components/       React components; ui/ holds the shadcn primitives
lib/              browser helpers: API client, filters, formatting
proxy.ts          the APP_PASSWORD gate
src/
  clients/        the product: clients, people, networks, finder, settings
  intelligence/   prompts, the model client, scoring rules, the review agent
  enrichment/     treg client and the record of every paid call
  storage/        S3 client for raw responses
  db/             Drizzle schema, tenant-scoped transactions, RLS policies
  web/            JSON API and the tenant lookup
  scripts/        migrate.ts, eval.ts
drizzle/          generated migrations
```

Pages are server components that read Postgres directly; dialogs and buttons are client components that call `/api` and refresh. Types shared with the browser live in `src/clients/types.ts`, which imports nothing server-side.

### Data and isolation

Tables: `companies`, `people`, `person_identities`, `relationship_edges`, `fit_scores`, `search_briefs`, `tenant_profiles`, `enrichment_calls`, `source_objects`, `tenants`. Every table except `tenants` carries `tenant_id` and a row-level security policy on `app.tenant_id`, which `withTenant()` sets for each transaction. The app role cannot bypass it, which is why it is separate from the owner role.

## Design

The look and the rules for new UI are in [`.cursor/rules/style.mdc`](.cursor/rules/style.mdc). Cursor loads that file when working on pages and components.
