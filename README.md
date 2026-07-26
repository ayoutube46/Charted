# Charted — a field guide for learning your school management system

A personal, single-user learning tracker and living guidebook. You chart "regions"
(topics) as you discover them, add field notes (with screenshots), check off steps,
tag things, and get a compiled reference guide plus review reminders — all with
your own login.

Stack: static HTML/CSS/JS front end (hosted free on GitHub Pages) + Supabase
(auth, database, image storage) as the free backend.

---

## 1. Create your Supabase project

1. Go to https://supabase.com, sign up free, and create a new project.
2. Wait for it to finish provisioning (a couple of minutes).

## 2. Set up the database

1. In your Supabase project, open **SQL Editor > New query**.
2. Paste in the entire contents of `sql/schema.sql` from this folder and run it.
   This creates the `topics`, `notes`, `checklist_items`, and `activity_log`
   tables, and locks them down with Row Level Security so only you can ever
   read or write your own rows.

## 3. Set up image storage

1. Go to **Storage** in the Supabase sidebar and create a new bucket named
   exactly `note-images`. Leave it **private** (not public).
2. Go back to **SQL Editor** and run the three `storage.objects` policies at
   the bottom of `sql/schema.sql` (they may need to be run after the bucket
   exists — if they errored the first time, run just that section again now).

## 4. Turn off email confirmation (optional, recommended for a single-user app)

By default Supabase requires confirming your email before you can sign in.
Since this is just for you:

1. Go to **Authentication > Providers > Email**.
2. Turn off "Confirm email" if you'd rather skip that step.

(If you leave it on, just check your inbox after signing up the first time.)

## 5. Connect the site to your project

1. In Supabase, go to **Project Settings > API**.
2. Copy your **Project URL** and **anon public key**.
3. Open `js/config.js` in this folder and paste them in:

```js
const SUPABASE_URL = "https://xxxxxxxx.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOi...";
```

The anon key is safe to expose in client-side code — Row Level Security is
what actually protects your data.

## 6. Deploy to GitHub Pages

1. Create a new **private** GitHub repository (private is fine — GitHub
   Pages can still serve it; or make it public if you don't mind).
2. Push the contents of this folder to the repo:

```bash
git init
git add .
git commit -m "Charted — initial version"
git branch -M main
git remote add origin https://github.com/<your-username>/<repo-name>.git
git push -u origin main
```

3. On GitHub, go to **Settings > Pages**.
4. Under "Build and deployment," set **Source: Deploy from a branch**,
   branch **main**, folder **/ (root)**. Save.
5. GitHub will give you a URL like `https://<your-username>.github.io/<repo-name>/`
   within a minute or two. That's your site.

## 7. Create your account

Visit your new site, click "Create an account," sign up with your email and
a password, and you're in. Since only you know your Supabase project exists,
this is effectively private to you.

---

## Using it

- **The Map** — your growing tree of topics/regions. Add a new one any time
  you discover a new part of the system. Click a region to open it.
- **Inside a region** — add field notes (with optional screenshots and tags),
  check off steps as you follow a how-to, mark quick-reference notes, and
  add sub-regions if a topic branches out.
- **Status** — Uncharted → Exploring → Charted, or flag "Needs review" any
  time. Marking something "Charted" triggers a little celebration.
- **Guidebook** — auto-compiled clean reference from everything you've
  charted — good for fast lookups once you trust the content.
- **Search** — full-text search across notes, steps, and region names.
- **Dashboard** — overall progress ring, streak counter, and what's due for
  review (anything flagged, or charted topics you haven't revisited in 14+ days).
- **Export as Markdown** — from the Map view, download your whole guidebook
  as a `.md` file any time, as a backup.

## Notes on cost

Everything here runs on free tiers (GitHub Pages + Supabase free tier), which
is more than enough for a single user's notes and screenshots.
