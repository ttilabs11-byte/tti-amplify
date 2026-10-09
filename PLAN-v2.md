# TTI Amplify v2: feature plan

## 0. Research inputs
- **Advocacy platforms** (EveryoneSocial, DSMN8, GaggleAMP, Haiilo, PostBeyond) share a common core:
  pre-written captions that staff personalise, points, badges and leaderboards, post-level and team analytics, quiet
  hours or scheduling, and audit logs.
- **LinkedIn ranking, 2026** (vendor and blog sources, not official): comments carry the most weight, and the
  thoughtful ones matter most. An early test window of 30 to 90 minutes probably still exists and is judged on dwell
  time. Employee-written text beats company copy by a large margin, and lightly personalised captions do about 3x
  better than identical ones. Identical text across many accounts looks inauthentic.
- **Design rule taken from this:** never hand 50 people the same comment. Give *starters* that rotate per person and
  must be personalised. Push hard on speed in the first hours.

## 1. The bar
| # | Criterion |
|---|---|
| V1 | The staff loop stays 4 taps or fewer. New features never add a step to it. |
| V2 | Every feature lifts real LinkedIn reach, saves admin time, or builds trust. Nothing decorative. |
| V3 | Privacy holds. Staff never see another person's ticks unless an admin explicitly turns on "top amplifiers". |
| V4 | Trust method intact: no verification theatre. |
| V5 | Secure by default. RLS on every new table, server-side role checks, no secret reaches the browser. |
| V6 | Works for low-tech lab staff on mid-range Android phones. |
| V7 | Each feature is tested with real screens and API checks, and scores 8/10 or more. |

## 2. Brainstorm (all ideas, before cutting)
Staff: comment starters · repost prompts · post image · boost-window timer · onboarding · LinkedIn profile checklist ·
points and levels · badges · monthly top amplifiers · active window for old posts · privacy explainer · Urdu UI ·
offline tick queue · pull to refresh · share the post with my own network on WhatsApp · AI-written comments.
Admin: auto reminders · quiet hours · insights dashboard (trend, department heatmap, inactive people) · LinkedIn
results entry (impressions and so on) · HOD role · duplicate-URL guard · monthly CSV matrix · audit log · approval
flow · post categories · spot-check verification · scheduled posts · Slack or Teams integration · UTM click tracking.
Tech: client error log · tests in the repo · custom domain · APK (TWA) · i18n framework.

## 3. Gauntlet: plan review

**Round 1: v0 = everything above.**

| Role | Score | Finding |
|---|---|---|
| Lab technician | 5 | Too many screens. Badges, levels, categories and a checklist all at once feel like homework. |
| HR | 7 | Loves insights and auto reminders. Spot-check verification breaks the trust model they chose. |
| HOD | 6 | Needs to see only their own team, and doesn't exist as a role yet. |
| Marketing admin | 6 | Approval flow and scheduled posts duplicate what LinkedIn already does. |
| Engineer | 4 | Urdu, AI comments, Slack, UTM and approvals are each multi-day jobs with low return. UTM is impossible because the links are LinkedIn's, not ours. |
| Privacy | 5 | Individual leaderboards visible to all shame low scorers. AI comments would need an API key and per-call cost. |
| Designer | 5 | Feature soup. The 4-tap loop is at risk. |
| Management | 7 | Wants proof that staff engagement lifts reach, so needs LinkedIn results next to participation. |
| **Mean** | **5.6** | |

**Cuts and changes → v1**
- *Cut:* Urdu UI (needs native review, so phase 3), AI comments (cost, keys, duplicate-text risk), Slack and Teams
  (they use WhatsApp), UTM (not possible), approval flow, scheduled posts, categories, spot-check verification (breaks
  trust), offline queue (ticks need the server anyway), and sharing on staff WhatsApp (low value).
- *Merge:* badges become **levels** shown on the summary, with no badge gallery. The checklist goes inside the
  onboarding instead of being a separate screen.
- *Privacy:* top amplifiers is **positive only** (top 5, first name and team), **off by default**, and switched on by
  an admin.
- *Starters:* each person is shown a **different** starter (picked by hashing person and post), carrying a "Make it
  yours" hint.
- *HOD:* a read-only role scoped to the HOD's own department.

**Round 2: v1**

| Role | Score | Finding → fix |
|---|---|---|
| Lab technician | 8 | Copy-and-open in one tap is the best change. The onboarding must be skippable → it has 3 cards and a Skip button. |
| HR | 9 | Auto reminder plus quiet hours plus insights cover their weekly work. |
| HOD | 8 | Sees only their own team's reports, people and insights. Wants a WhatsApp nudge text for their team → yes. |
| Marketing admin | 8 | Image upload and the duplicate guard. Wants starters editable later → editable in Edit post. |
| Engineer | 8 | One cron job (pg_cron with pg_net) calls `notify` with a secret. Scoping is centralised in a `scope_dept()` function. Images live in a public Storage bucket that only admins can write to. |
| Privacy | 9 | "What HR sees" explainer, positive-only leaderboard defaulting to off, audit log. |
| Designer | 8 | The staff loop is unchanged. New items live inside existing surfaces (card, summary, Me). |
| Management | 9 | The Insights page compares impressions with staff participation. |
| **Mean** | **8.4** | Passes. Build v1. |

## 4. v1 scope

**Staff**
- S1 **Comment starters.** The admin writes up to 5. Each person sees their own one. **Copy & open** copies it and
  opens LinkedIn in one tap. A repost prompt says "add one line of your own".
- S2 **Post image.** The admin uploads a screenshot or picture, which is resized to WebP of 1200 px or less on the
  device.
- S3 **Boost window.** For the first 3 h after posting, a "Boost window · 1 h 20 m left" chip shows. Early engagement
  counts most.
- S4 **Onboarding.** 3 swipe cards after the first sign-in: how it works, the LinkedIn readiness checklist (follow the
  Tti page, list Tti as current employer, add a profile photo), and notifications. The checklist can be revisited
  under Me.
- S5 **Points and levels.** React 1, comment 3, repost 3. This month's points and the all-time level show on the
  summary.
- S6 **Top amplifiers** of the month under Teams: top 5, positive only, shown only when an admin has turned it on.
- S7 **Active window.** To do lists only posts from the last N days (setting, default 14). Older unticked posts sit in
  a collapsed "Older" list that doesn't count against you.
- S8 **"What HR sees"** privacy sheet, linked from Me and from sign-up.

**Admin and HOD**
- A1 **Auto reminder.** A cron job runs every 10 min. N hours after a post goes live (setting, default 4), it pushes a
  reminder to pending people only. Quiet hours run 21:00–08:00 Pakistan time (setting). It runs once per post.
- A2 **Insights.** A participation trend over the last 12 posts, a department × post heatmap, people inactive for 30
  days (with a WhatsApp nudge text), the month's top amplifiers, and LinkedIn results against participation.
- A3 **LinkedIn results** on each post report: impressions, reactions, comments and reposts, entered from LinkedIn
  analytics.
- A4 **HOD role.** Read-only access to reports, insights and people for the HOD's own department only.
- A5 **Duplicate-URL guard.**
- A6 **Monthly CSV** matrix: people × posts, ticks per cell.
- A7 **Audit log.** Role, access, code, password-reset and post-archive actions, showing the last 50 in Settings.
- A8 **Settings.** Active window, auto-reminder delay, quiet hours, and showing top amplifiers.

**Tech**
- T1 Client error log (rate-limited RPC).
- T2 API test suite committed under `tests/`.
- T3 SW v3, CSP updated for Storage images, migration file updated.

**Deferred, with reasons:** Urdu (needs native review), AI comments (cost and duplicate risk), LinkedIn auto-verify
(needs API approval), APK and custom domain (user steps; see the README).

## 5. Build gauntlet
Score real screenshots (phone and desktop, light and dark) on Visual, UX, Correctness and Security until each is 8 or
more. API suite: every role boundary for HOD, member and admin, cron secret, settings writes, Storage writes.
