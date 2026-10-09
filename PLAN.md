# TTI Amplify: plan

An Android and web app that lists every Tti LinkedIn post. Staff sign up, open each post, react, comment or repost, then
confirm it in the app (trust method). HR and HODs see who has done it.

## 1. The bar (what "10/10" means)

| # | Criterion | Pass test |
|---|---|---|
| B1 | Instant | Live the same day. No LinkedIn API approval, no app-store review, no email server. |
| B2 | Zero-friction sign-up | A lab technician on a mid-range Android phone joins in under 60 s with name, department, email, password and the company code. |
| B3 | One-tap loop | From a WhatsApp link: open app, tap "Open post", act on LinkedIn, come back, confirm. 4 taps or fewer of our own UI. |
| B4 | Trust, with light integrity | Ticks unlock only after the post was opened from the app. Each confirm stores a timestamp. Nothing auto-ticks. |
| B5 | Admin speed | A new post goes live in under 20 s: paste the URL (or share it straight from the LinkedIn app), add a title, save, and send it to WhatsApp in one tap. |
| B6 | Visibility | Per post: done or not done by department, with names, and a CSV export. Per person: totals. Staff see only their own data plus department rankings, never anyone else's. |
| B7 | Secure | RLS on every table. The company code and admin rights are enforced server-side. No secrets in the public code. Supabase advisors clean. |
| B8 | Premium design | Brand navy and blues, refined type, motion with purpose, light and dark themes, 48 px touch targets, WCAG AA contrast, no layout jumps. |
| B9 | Installs like a native app | Installable PWA: icon, splash screen, full screen, offline shell. Android share target for admins. A real APK is possible later from the same URL. |
| B10 | Survives quiet weeks | Free Supabase projects pause after 7 idle days. A daily keep-alive stops that. |

## 2. Architecture

- **Frontend:** a single-page PWA in vanilla ES modules, with no build step and no npm install. supabase-js v2 is
  vendored (MIT). It's hosted free on **GitHub Pages** (`ttilabs11-byte.github.io/tti-amplify`), and a custom domain
  such as `amplify.ttilabs.net` can be added later with one DNS record.
- **Backend:** a new free Supabase project, `tti-amplify` (ap-south-1, Mumbai, the closest region to Pakistan),
  providing Postgres, Auth (email and password) and Realtime.
- **Sign-up:** handled by an Edge Function `signup` that checks the company code server-side, then creates the user
  pre-confirmed through the admin API. No confirmation email is needed, which avoids Supabase's 2-emails-an-hour limit.
- **Admin actions:** an Edge Function `admin` covers password resets (staff have no email reset) and changing the
  codes. It checks the caller's JWT and admin role.
- **Keep-alive:** a GitHub Actions cron job calls the REST endpoint once a day.
- **LinkedIn link-up:** none. Without API approval no tool can read the page feed, so posts are added by hand. With
  the share target, that's two taps from the LinkedIn app.

## 3. Data model

```
departments(id, name, sort)
profiles(id→auth.users, full_name, department_id, role member|admin, active, created_at)
posts(id, url, title, note, asks text[] {react,comment,repost}, posted_on, created_by, archived, created_at)
engagements(user_id, post_id, opened_at, reacted, commented, reposted, confirmed_at, updated_at)  PK(user_id,post_id)
app_secrets(key, value)   -- join codes; RLS on, no policies → never readable by clients
signup_attempts(ip, at)   -- rate limit 10/hour/IP
```
RPCs (SECURITY DEFINER, `search_path=''`): `is_admin()`, `my_summary()`, `dept_board()` (aggregates only),
`mark_opened(post)`, `confirm_engagement(post, r, c, p)`. Confirming fails if the post was never opened.

## 4. Screens

**Staff**
1. *Welcome*: logo, one line on why it matters, Sign in or Create account.
2. *Create account*: full name, department (picker), email, password (with show toggle), company code.
3. *Home*: greeting, a progress ring (done this month), streak, then **To do** and **Done** tabs. Each post card shows
   the title, date, admin note ("Comment idea: …"), action chips (React, Comment, Repost; only the asked ones) and a big
   **Open on LinkedIn** button.
4. *Confirm sheet*: opens automatically when you return to the app after opening a post (it survives an Android tab
   kill through localStorage). It asks "What did you do?", with large toggles for the asked actions and the note
   "Ticking confirms you did it on LinkedIn." Buttons: Save or Not yet. Saving gives a haptic tick and moves the card
   to Done with a check animation.
5. *Teams*: department ranking by participation % (no individual names).
6. *Me*: name, department, totals, theme, install the app, sign out.

**Admin (same app, extra tab)**
7. *Posts*: add or edit (URL, title, note, asks, date), archive, and "Send to WhatsApp" (opens `wa.me/?text=` with a
   deep link `…/#/p/<id>`).
8. *Post report*: completion %, a split by department, Done and Not done lists with names, and a CSV export.
9. *People*: search, department, totals, make admin, reset password, deactivate.
10. *Settings*: staff code and admin code, departments.

## 5. Gauntlet: plan review

**Round 1: draft v0** (staff sign up with email confirmation, any post can be ticked anytime, posts typed in by hand,
names visible to all)

| Role | Score | Finding |
|---|---|---|
| Lab technician (user) | 6 | Email confirmation stalls sign-up, since many check work mail only on a PC. |
| HR / HOD | 6 | No per-department split, no CSV, and no way to remind people. |
| Engineer | 5 | Supabase's built-in email sends only about 2 per hour, so a rollout to 60 people fails. Free projects also pause after 7 idle days. |
| Security | 5 | A code in the frontend is public on GitHub Pages, and anyone could sign up. Names shown to everyone creates a shaming risk. |
| Designer | 6 | Ticking without opening invites box-ticking, and there's no return-to-app moment. |
| Admin (marketing) | 5 | Copying URLs from the LinkedIn app on a phone is fiddly. |
| **Mean** | **5.5** | |

**Fixes applied → v1:** sign-up through an Edge Function with server-side code check and pre-confirmed users; ticks
unlock only after opening; the auto confirm sheet on return; a department split and CSV; a WhatsApp send button; the
Android share target; the keep-alive cron; staff see only aggregates; admin password resets (since there's no
email); a rate limit on sign-up.

**Round 2: v1**

| Role | Score | Finding |
|---|---|---|
| Lab technician | 8 | Fine. Wants the app to remember them. → Persistent session (supabase-js default). |
| HR / HOD | 8 | Wants a "who hasn't done it" list to chase. → *Not done* list on the post report, plus a WhatsApp reminder text listing the department's pending count (no names in public groups). |
| Engineer | 8 | When Android kills the PWA during the LinkedIn hop, the pending state must survive. → localStorage `pending={post,at}`, with a 2 h expiry. |
| Security | 8 | Admin code must also be server-side. Deactivated users must lose access. → `active=false` blocks the RPCs, and a ban through the admin API. |
| Designer | 8 | Needs an empty state, skeletons, an offline banner, and a toast when a new post arrives over realtime. Added. |
| Admin | 9 | The share target, deep links and WhatsApp send cover it. |
| **Mean** | **8.2** | Passes the 8 bar. Proceed to build. |

## 6. Known limits (said honestly)
- No automatic verification. It's the trust method by design.
- A posts feed that updates itself from the LinkedIn page needs LinkedIn API approval (weeks). Manual add is the
  fast path.
- Push notifications are phase 2. WhatsApp is the notifier for now.
- An APK for side-loading or the Play Store comes later through PWABuilder (TWA) from the live URL, with no code change.

## 7. Build gauntlet (execution)
Score real screenshots at 375 × 812 and 1280 × 800, in light and dark, out of 10, across Visual, UX flow, Correctness
and Security. Iterate until every axis is 8 or more.
