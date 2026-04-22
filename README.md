# Sports Betting Content Engine

A private, no-API Twitter scraper that tracks sharp betting accounts, finds consensus picks, and drafts tweets for you to review and post.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  apps/worker                  (runs in background)          │
│  ├── scanner/   Playwright scrapes X timelines (stealth)    │
│  └── pipeline/  OCR → picks → clusters → tweet drafts      │
├─────────────────────────────────────────────────────────────┤
│  apps/mobile-web              (your iPhone dashboard)       │
│  └── Next.js PWA  Review / approve / reject tweet drafts   │
├─────────────────────────────────────────────────────────────┤
│  packages/                                                  │
│  ├── shared   types, constants, utilities                   │
│  ├── db       Prisma client + query helpers                 │
│  ├── ocr      Tesseract image-to-text                       │
│  ├── ai       Claude / OpenAI with monthly budget guard     │
│  └── core     pick parser, normalizer, cluster engine       │
└─────────────────────────────────────────────────────────────┘
                          │
                    PostgreSQL DB
```

---

## Prerequisites

- Node.js 20+
- pnpm 9+ (`npm i -g pnpm`)
- PostgreSQL 15+ running locally (or connection string to remote)
- Tesseract OCR (`brew install tesseract` / `apt install tesseract-ocr`)
- An Anthropic API key (or OpenAI key)
- A Twitter/X account the worker will log in as

---

## Setup

### 1. Install dependencies

```bash
pnpm install
```

### 2. Install Playwright browsers

```bash
pnpm exec playwright install chromium
```

### 3. Configure environment

```bash
cp .env.example .env
```

Edit `.env` and fill in:
- `DATABASE_URL` — your PostgreSQL connection string
- `X_USERNAME`, `X_EMAIL`, `X_PASSWORD` — your Twitter credentials
- `ANTHROPIC_API_KEY` — from console.anthropic.com
- `APP_PASSWORD` — any password you want for the mobile web app
- `CLAUDE_MONTHLY_BUDGET_USD` — default is `20`

### 4. Create the database and run migrations

```bash
pnpm db:generate    # generates Prisma client
pnpm db:migrate     # runs migrations and creates tables
```

### 5. Seed starter accounts

```bash
pnpm db:seed
```

This adds 8 starter accounts to track. Edit `scripts/seed.ts` to add your own.

---

## First X Login

The worker needs a live session cookie to scrape without using the Twitter API.

```bash
pnpm auth:x
```

A real browser window opens. The script auto-fills your credentials if they're in `.env`.
Complete any 2FA or captcha challenge, then press **Enter** in the terminal when you see the home feed.

The session is saved to `auth-state/x-session.json` (gitignored).  
Re-run `pnpm auth:x` if the worker ever logs you out.

---

## Running the Worker

### One-time scan (great for testing)

```bash
pnpm worker:once
```

### Continuous loop (runs every `WORKER_SCAN_INTERVAL_MINUTES`)

```bash
pnpm worker:start
```

### Watch mode (auto-restarts on code changes)

```bash
pnpm worker:watch
```

### Debug mode (verbose logging)

```bash
pnpm worker:debug
```

The worker does this every cycle:
1. Opens a fake iPhone browser, logs in with saved session
2. Scrolls each tracked account's timeline
3. Downloads images and runs OCR on them
4. Extracts picks from tweet text + OCR text
5. Groups matching picks into trend clusters
6. Generates tweet drafts via Claude (stops if monthly budget is hit)

---

## Mobile Web App

```bash
pnpm web:dev
```

Open `http://localhost:3000` in your browser, or on your iPhone:

### Accessing from your iPhone on local network

1. Find your Mac's local IP: `ipconfig getifaddr en0` (Mac) or `hostname -I` (Linux)
2. On your iPhone, open Safari and go to `http://192.168.x.x:3000`
3. Log in with your `APP_PASSWORD`
4. Tap the **Share** button → **Add to Home Screen**

You now have a native-feeling app on your iPhone home screen.

### Pages

| Page | What it does |
|------|-------------|
| `/tweets` | Review AI-generated tweet drafts — approve or reject |
| `/trends` | See which picks have the most consensus across accounts |
| `/picks` | All raw extracted picks |
| `/posts` | All scraped posts |
| `/accounts` | Manage tracked accounts, pause/resume |
| `/settings` | See current AI spend vs. monthly budget |

---

## AI Budget

The engine tracks every Claude/OpenAI API call and stops making calls when you hit the cap.

- Default cap: **$20/month** (set via `CLAUDE_MONTHLY_BUDGET_USD`)
- Resets automatically each calendar month
- Current spend is visible in the Settings page of the mobile app
- Logs a warning in the worker at 80% used

Estimated cost at normal usage (100 scans/day, 8 tweet drafts/day with claude-haiku-4-5): **~$3–5/month**

---

## Prisma Commands

```bash
pnpm db:generate    # regenerate client after schema changes
pnpm db:migrate     # apply new migrations
pnpm db:push        # push schema directly (dev only, no migration file)
pnpm db:studio      # open Prisma Studio GUI
pnpm db:seed        # seed starter accounts
pnpm db:reset       # DANGER: drops and recreates the DB
```

---

## Known Limitations

- **X/Twitter may change their internal structure** at any time, breaking the scraper. The DOM fallback (`article[data-testid="tweet"]`) provides a secondary path, but may also need updates.
- **OCR quality depends on image resolution.** Low-res bet slip screenshots may extract garbage. Confidence scores help filter these out.
- **The session will expire** if you don't use it for a while, or if X logs out all sessions. Re-run `pnpm auth:x`.
- **No posting automation.** Tweet drafts are for you to review and copy-paste manually. Automated posting is deliberately not included.

---

## Troubleshooting

**Worker crashes with "BUDGET_EXCEEDED"**  
→ You've hit your monthly AI cap. Raise `CLAUDE_MONTHLY_BUDGET_USD` in `.env` or wait for the month to reset.

**"Auth state file not found"**  
→ Run `pnpm auth:x` first.

**OCR returns garbage text**  
→ The bet slip image is too low-res. Tesseract needs at least 300 DPI. The OCR pipeline upscales images 2x automatically, but very small images won't help.

**Playwright can't find Chrome**  
→ Run `pnpm exec playwright install chromium`.

**"Cannot find module @sports-engine/db"**  
→ Run `pnpm db:generate` to generate the Prisma client.
