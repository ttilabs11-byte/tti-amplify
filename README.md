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

## For admins (HR and HODs)
- **Add a post:** Admin, then **Add post**. Paste the LinkedIn link and give it a title. On Android, in the LinkedIn
  app tap **Share**, then **TTI Amplify**, and the link fills itself in.
- **Tell staff:** after publishing, tap **Send to WhatsApp**. The message carries a deep link to the post.
- **Track:** open a post to see the percentage done, the split by department, who is done and who is pending.
  **Remind** sends a WhatsApp message with pending counts per team (no names), and **CSV** exports the list.
- **People:** reset a password (the app makes a temporary one to share privately), make someone an admin, or switch
  off access.
- **Invite & settings:** copy or regenerate the staff code and the admin code, and edit departments.

## How it works
| Part | Technology |
|---|---|
| App | Vanilla ES modules with no build step (`app/`). A service worker caches the shell, and the manifest adds install, a share target and shortcuts. |
| Data and logins | Supabase project `tti-amplify` (ap-south-1): Postgres with row-level security, Auth, and Realtime for new posts. |
| Sign-up | Edge Function `signup` checks the company code on the server and creates a confirmed user. No email server is needed. |
| Admin actions | Edge Function `admin` handles codes, password resets, roles and access, and checks the caller is an active admin. |
| Hosting | GitHub Pages through `.github/workflows/pages.yml`. |
| Keep-alive | `.github/workflows/keepalive.yml` pings Supabase daily, so the free project never pauses. |

Schema and functions live in `supabase/`. The publishable key in `app/js/api.js` is meant to be public: row-level
security and the Edge Functions do the protecting. The company codes are stored only in the database and never reach
the browser except for admins.

## Integrity rules (enforced by the database)
- A tick needs a prior "opened" record, and the open is recorded when the person taps **Open on LinkedIn**.
- Staff can read only their own ticks. Departments see only aggregate percentages.
- Only admins can add or edit posts, see names, or export.

## Deploy a change
Push to `main`. The Pages workflow publishes `app/`. Bump `VERSION` in `app/sw.js` on every release so installed apps
pick up the new files.

## Android APK (optional)
Open https://www.pwabuilder.com, enter the live URL and choose **Android**. It packages this PWA as a Trusted Web
Activity APK for side-loading or the Play Store, with no code changes.
