# TTI Amplify

An Android and web app (an installable PWA) that helps Tti staff support the company's LinkedIn posts. Every post is
listed in one feed. Staff open it on LinkedIn, react, comment or repost, then come back and tick what they did. Ticks
run on trust. HR and admins see progress per post, per department and per person.

**Live app:** https://ttilabs11-byte.github.io/tti-amplify/

## For staff
1. Open the link from the staff WhatsApp group and choose **Create account**. Enter your name, department, email,
   password and the company code that HR shares.
2. Install it when your phone offers. On Android: browser menu (⋮), then **Install app**. On iPhone: Safari, then
   **Share**, then **Add to Home Screen**.
3. Tap **Open on LinkedIn** on a post, engage there, and come back. The app asks what you did. Tick it and confirm.
4. Turn on **notifications** (the banner on the home screen, or **Me → Notifications**) to get an alert the moment a
   new post goes live. On iPhone this works only after you add the app to the Home Screen (iOS 16.4 or later).
5. A post may carry a **comment starter**. **Copy & open** copies it and opens the post. Change a few words before you
   post it: identical comments from many accounts look fake to LinkedIn. Each person sees a different starter.
6. A **boost window** chip marks the first 3 hours after a post goes live, when engagement helps the most.
7. **Me** shows your points (react 1, comment 3, repost 3), your level, and a 3-item LinkedIn-ready checklist.
   **What HR sees** explains exactly what is recorded. Posts older than the To do window move to **Older posts**.

## For admins (HR)
- **Add a post:** Admin, then **Add post**. Paste the LinkedIn link and give it a title. On Android, in the LinkedIn
  app tap **Share**, then **TTI Amplify**, and the link fills itself in. Optionally add an image (resized on the phone
  to WebP) and up to 5 comment starters, one per line. The same live link cannot be added twice.
- **Tell staff:** publishing sends a phone notification to everyone who turned them on, and the confirmation shows
  how many people it reached. Tap **Send to WhatsApp** to reach the rest. The message carries a deep link to the post.
- **Push reminder:** on a post's report, this notifies only the people who have not ticked it yet. It can be sent at
  most once every 2 hours per post. In **People**, "alerts on" marks who has notifications turned on.
- **Track:** open a post to see the percentage done, the split by department, who is done and who is pending.
  **Remind** sends a WhatsApp message with pending counts per team (no names), and **CSV** exports the list.
- **Automatic reminder:** a few hours after a post goes live (4 by default), staff who have not ticked get one push
  reminder. It skips quiet hours (21:00 to 08:00 Pakistan time) and skips a post that had a manual reminder recently.
- **LinkedIn results:** about a week after posting, copy impressions, reactions, comments and reposts from the page's
  post analytics into the post's report. **Insights** then compares reach with staff participation.
- **Insights:** participation per post, impressions, a team-by-post heatmap, top amplifiers this month, and people
  quiet for 30 days with a personal WhatsApp **Nudge**.
- **Month CSV:** on the post list, one row per person and one column per post that month (R, C, P = reacted,
  commented, reposted).
- **People:** reset a password, set a role (member, head of department, admin), or switch off access.
- **Invite & settings:** codes, departments, app settings (To do window, reminder delay, quiet hours, whether staff
  see the top 5) and the activity log of the last 50 admin actions.

## For heads of department
An admin sets the role to **Head of department**. The **Reports** tab then shows read-only posts, insights, people and
CSV exports for their own department only. The database enforces the scope.

## How it works
| Part | Technology |
|---|---|
| App | Vanilla ES modules with no build step (`app/`). A service worker caches the shell, and the manifest adds install, a share target and shortcuts. |
| Data and logins | Supabase project `tti-amplify` (ap-south-1): Postgres with row-level security, Auth, and Realtime for new posts. |
| Sign-up | Edge Function `signup` checks the company code on the server and creates a confirmed user. No email server is needed. |
| Admin actions | Edge Function `admin` handles codes, password resets, roles and access, and checks the caller is an active admin. |
| Auto-reminders | `pg_cron` runs every 10 minutes and calls `notify` with a secret header; `due_auto_reminders()` picks the posts. |
| Notifications | Web Push with VAPID keys. Edge Function `notify` (admins only) sends "new post" alerts to every device and "reminder" alerts to pending people only, and removes dead devices. The private key lives only in the database. |
| Hosting | GitHub Pages through `.github/workflows/pages.yml`. |
| Keep-alive | `.github/workflows/keepalive.yml` pings Supabase daily, so the free project never pauses. |

Schema and functions live in `supabase/`. The publishable key in `app/js/api.js` is meant to be public: row-level
security and the Edge Functions do the protecting. The company codes are stored only in the database and never reach
the browser except for admins.

## Integrity rules (enforced by the database)
- A tick needs a prior "opened" record, and the open is recorded when the person taps **Open on LinkedIn**.
- Staff can read only their own ticks. Departments see only aggregate percentages.
- Only admins can add or edit posts, change settings, or read the audit log. Heads of department see names and exports
  for their own department only.
- Settings values are checked by the database, and every post, role, code and setting change is audited.

## Tests
`tests/api.e2e.mjs` checks roles, HOD scoping, settings, storage, the cron secret and the audit log against the live
project with throwaway accounts (`@example.com`):

```bash
AMPLIFY_STAFF_CODE=... AMPLIFY_ADMIN_CODE=... node tests/api.e2e.mjs
```

Afterwards delete the throwaway users (`email like 'amplify.%@example.com'`), the posts they created, and any test
images.

## Deploy a change
Push to `main`. The Pages workflow publishes `app/`. Bump `VERSION` in `app/sw.js` on every release so installed apps
pick up the new files.

## Android APK (optional)
Open https://www.pwabuilder.com, enter the live URL and choose **Android**. It packages this PWA as a Trusted Web
Activity APK for side-loading or the Play Store, with no code changes.
