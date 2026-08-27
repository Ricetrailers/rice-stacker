# Rice Stacker — self-hosted (Supabase edition)

The load-stacking app, ported off the Claude artifact onto your own stack:
static front end + Supabase for logins, data, and photos. Every load and
trailer profile saves as its own database row, so multiple people can work
at the same time without stepping on each other, and photos go to real
object storage with room for years.

## What's in here

| file | what it is |
|---|---|
| `index.html` | the app shell (login gate + app) |
| `styles.css` | all styling |
| `app.js` | the whole app (loads, library, drawing editor, auto-stack…) |
| `storage.js` | Supabase adapter — auth, per-row diff saves, photo upload. Falls back to an in-memory dev mode when `config.js` isn't filled in |
| `dxf.js`, `dxf_cluster.js` | DXF parsing + sheet splitting |
| `seed.json` | the Rice trailer library (loaded into the DB on first run) |
| `schema.sql` | run once in Supabase to create tables, security rules, photo bucket |
| `config.js` / `config.example.js` | your Supabase URL + anon key |

## One-time setup (~10 minutes)

1. **Supabase project** — [supabase.com](https://supabase.com) → New project
   (free tier is fine to start; the Pro plan's 100 GB storage covers ~30 years
   of photos at 3–4 loads/day).
2. **Schema** — dashboard → SQL Editor → New query → paste all of
   `schema.sql` → Run.
3. **Team accounts** — dashboard → Authentication → Users → Add user →
   email + password for each person. Then Authentication → Sign In / Up →
   turn **off** "Allow new users to sign up" so only accounts you create work.
4. **Config** — copy `config.example.js` to `config.js`, fill in
   Project Settings → API → `URL` and `anon public` key. (The anon key is
   designed to be public — row security is what protects the data.)
5. **Run it** — any static host, or locally: `npx serve .` in this folder.
   First sign-in loads the Rice library automatically.

## Moving your data over from the artifact

In the old app: home screen → **Export backup file**. In this app:
home screen → **Restore from file…** → pick that file. Loads, library,
folders, and photos all come across (photos upload to the bucket as part
of the restore).

## Hosting / updates

It's a plain static site — GitHub Pages, Netlify, Cloudflare Pages, or a
folder on any web server all work. No build step. To update, replace the
files. If you keep it in a GitHub repo with Pages enabled, an update is
just a push.

## Day-to-day notes

- **Saving**: auto-saves ~2.5 s after you pause, flushes when the tab
  closes; the pill in the header is the truth. Only *changed* rows are
  written, so two people on different loads never collide. Two people
  editing the *same load* at the same moment is still last-save-wins.
- **Photos**: compressed to ~250 KB and uploaded the moment you add them.
  3 pics × 4 loads/day ≈ 1 GB/year.
- **Dev mode**: with a placeholder `config.js`, the app runs fully
  in-memory (header shows DEV MODE) — handy in Cursor while hacking on it.
- The old artifact keeps working; once the team is on this, treat the
  artifact as read-only history.
