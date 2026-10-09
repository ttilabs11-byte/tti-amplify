// Insights for admins and HODs (scoped server-side): participation trend, LinkedIn impressions,
// department heatmap, top amplifiers, people quiet for 30 days.
import * as api from '../api.js';
import { h, icon, errorText, relDate, initials, avatarColor } from '../ui.js';
import { APP_URL } from '../store.js';

const HIGH_PARTICIPATION = 50;
const INK_FLIP_PCT = 60;
const MIN_RAMP = 8;

const pctOf = (done, members) => (Number(members) ? Math.round((Number(done) / Number(members)) * 100) : 0);
const shortTitle = (t) => (t.length > 34 ? `${t.slice(0, 33)}…` : t);
const shortDate = (d) => new Date(`${d}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
const midSentence = (s) => s.replace(/^(Today|Yesterday)/, (w) => w.toLowerCase());
const QUIET_GRACE_MS = 7 * 86_400_000;
const firstName = (n) => String(n ?? '').split(' ')[0];

export async function renderInsights(body) {
  body.replaceChildren(h('div', { class: 'admin-grid' }, [0, 1, 2].map(() => h('div', { class: 'skel', style: { height: '180px' } }))));
  let data;
  try {
    data = await api.insights();
  } catch (err) {
    body.replaceChildren(h('div', { class: 'empty' }, icon('alert'), h('h3', null, 'Could not load insights'), h('p', null, errorText(err))));
    return;
  }
  const trend = (data?.trend ?? []).map((t) => ({ ...t, pct: pctOf(t.done, t.members) }));
  if (!trend.length) {
    body.replaceChildren(h('div', { class: 'empty' }, icon('chart'), h('h3', null, 'No posts yet'), h('p', null, 'Insights build up as posts go live and colleagues tick them.')));
    return;
  }
  const members = Number(trend[0].members);
  // New joiners get a week before they count as quiet.
  const quiet = (data.inactive ?? []).filter((p) => p.last_confirmed || Date.now() - new Date(p.created_at).getTime() > QUIET_GRACE_MS);
  const avg = Math.round(trend.reduce((s, t) => s + t.pct, 0) / trend.length);
  const withLi = trend.filter((t) => t.li_impressions != null);
  const avgImp = withLi.length ? Math.round(withLi.reduce((s, t) => s + Number(t.li_impressions), 0) / withLi.length) : null;

  body.replaceChildren(
    h('div', { class: 'kpis' },
      kpi(`${avg}%`, `Avg. done, last ${trend.length}`),
      kpi(String(members - quiet.length), `Active of ${members}`),
      kpi(avgImp == null ? '–' : avgImp.toLocaleString('en-GB'), 'Avg. impressions')),
    chartCard('Participation by post', 'Share of members who ticked each post, oldest to newest.',
      barChart(trend.map((t) => ({ value: t.pct, label: `${t.pct}%`, axis: shortDate(t.posted_on), tip: `${t.title} · ${relDate(t.posted_on)} · ${t.done} of ${t.members} done (${t.pct}%)` })), 100),
      trendTable(trend)),
    impressionsCard(trend, withLi),
    heatCard(trend, data.heat ?? []),
    h('div', { class: 'admin-grid two mt-16' }, topCard(data.top ?? []), inactiveCard(quiet)));
}

const kpi = (value, label) => h('div', { class: 'kpi' }, h('b', null, value), h('span', null, label));

function chartCard(title, sub, chart, table, note) {
  return h('section', { class: 'card card-pad stack-s mt-16 chart-card' },
    h('h3', null, title), h('p', { class: 'hint' }, sub), chart, note ?? null,
    table ? h('details', { class: 'chart-table' }, h('summary', null, 'Show as table'), table) : null);
}

// Bars anchored to the baseline; every bar is focusable and carries its own tooltip.
function barChart(items, max) {
  const top = Math.max(max, 1);
  return h('div', { class: 'bar-chart' },
    h('div', { class: 'bars', role: 'list' }, items.map((it) => {
      const pct = Math.max((it.value / top) * 100, it.value ? 2 : 0);
      return h('div', { class: 'bar-col', role: 'listitem', tabindex: 0, 'data-tip': it.tip, 'aria-label': it.tip, style: { '--h': `${pct}%` } },
        h('span', { class: 'bar-val', 'aria-hidden': 'true' }, it.label), h('i'));
    })),
    h('div', { class: 'bar-axis', 'aria-hidden': 'true' }, items.map((it) => h('span', null, it.axis))));
}

function table(header, rows) {
  return h('div', { class: 'table-wrap' }, h('table', { class: 'data-table' },
    h('thead', null, h('tr', null, header.map((c) => h('th', { scope: 'col' }, c)))),
    h('tbody', null, rows.map((r) => h('tr', null, r.map((c, i) => (i ? h('td', null, c) : h('th', { scope: 'row' }, c))))))));
}

const trendTable = (trend) => table(['Post', 'Date', 'Done', 'Share'],
  trend.slice().reverse().map((t) => [t.title, relDate(t.posted_on), `${t.done}/${t.members}`, `${t.pct}%`]));

function impressionsCard(trend, withLi) {
  if (!withLi.length) {
    return chartCard('LinkedIn impressions', 'Record results on a post (Posts, open a post, LinkedIn results) to see reach here.',
      h('p', { class: 'muted small' }, 'No results recorded yet.'));
  }
  const max = Math.max(...withLi.map((t) => Number(t.li_impressions)));
  const chart = barChart(withLi.map((t) => ({ value: Number(t.li_impressions), label: compact(t.li_impressions), axis: shortDate(t.posted_on),
    tip: `${t.title} · ${Number(t.li_impressions).toLocaleString('en-GB')} impressions · ${t.pct}% of staff engaged` })), max);
  return chartCard('LinkedIn impressions', 'Reach of each post with recorded results.', chart,
    table(['Post', 'Impressions', 'Reactions', 'Comments', 'Reposts', 'Staff done'],
      withLi.slice().reverse().map((t) => [t.title, n(t.li_impressions), n(t.li_reactions), n(t.li_comments), n(t.li_reposts), `${t.pct}%`])),
    liftNote(withLi));
}

const n = (v) => (v == null ? '–' : Number(v).toLocaleString('en-GB'));
const compact = (v) => new Intl.NumberFormat('en-GB', { notation: 'compact', maximumFractionDigits: 1 }).format(Number(v));

function liftNote(withLi) {
  const hi = withLi.filter((t) => t.pct >= HIGH_PARTICIPATION);
  const lo = withLi.filter((t) => t.pct < HIGH_PARTICIPATION);
  const mean = (list) => Math.round(list.reduce((s, t) => s + Number(t.li_impressions), 0) / list.length);
  if (!hi.length || !lo.length) {
    return h('p', { class: 'honour' }, icon('info'), `Record a few more posts, some above and some below ${HIGH_PARTICIPATION}% staff participation, to compare reach.`);
  }
  const a = mean(hi);
  const b = mean(lo);
  const lift = b ? Math.round(((a - b) / b) * 100) : 0;
  return h('p', { class: 'honour' }, icon('chart'),
    `Posts where ${HIGH_PARTICIPATION}%+ of staff engaged averaged ${a.toLocaleString('en-GB')} impressions, against ${b.toLocaleString('en-GB')} below that`
    + (lift > 0 ? ` (${lift}% more).` : '.') + ` Based on ${withLi.length} posts.`);
}

function heatCard(trend, heat) {
  const byId = new Map(trend.map((t) => [t.id, t]));
  const postIds = [...new Set(heat.map((x) => x.post_id))].sort((a, b) => (byId.get(a)?.posted_on ?? '').localeCompare(byId.get(b)?.posted_on ?? ''));
  const depts = [...new Set(heat.map((x) => x.department))];
  if (!postIds.length || !depts.length) return null;
  const cell = new Map(heat.map((x) => [`${x.department}|${x.post_id}`, x]));
  const grid = h('div', { class: 'heat', style: { '--cols': postIds.length }, role: 'table', 'aria-label': 'Share done by department and post' },
    h('div', { class: 'heat-row heat-head', role: 'row' }, h('span', { role: 'columnheader' }, 'Team'),
      postIds.map((id) => h('span', { role: 'columnheader', title: byId.get(id)?.title ?? '' }, shortDate(byId.get(id)?.posted_on ?? '')))),
    depts.map((d) => h('div', { class: 'heat-row', role: 'row' }, h('span', { role: 'rowheader' }, d),
      postIds.map((id) => {
        const x = cell.get(`${d}|${id}`);
        const pct = x ? pctOf(x.done, x.members) : null;
        const tip = `${d} · ${byId.get(id)?.title ?? ''} · ${x ? `${x.done} of ${x.members} (${pct}%)` : 'no data'}`;
        return h('span', { class: 'heat-cell', role: 'cell', tabindex: 0, 'data-tip': tip, 'aria-label': tip,
          style: { '--mix': `${pct == null ? 0 : Math.max(pct, MIN_RAMP)}%`, color: pct >= INK_FLIP_PCT ? 'var(--primary-ink)' : 'var(--text)' } },
        pct == null ? '–' : `${pct}%`);
      }))));
  return chartCard('Teams by post', 'Share of each team that ticked the last posts. Stronger colour means more done.', h('div', { class: 'table-wrap' }, grid));
}

function topCard(top) {
  return h('section', { class: 'card card-pad stack-s' }, h('h3', null, 'Top amplifiers this month'),
    top.length
      ? h('ol', { class: 'list top-list' }, top.map((t, i) => h('li', null,
        h('span', { class: `rank-badge r${i + 1}` }, String(i + 1)),
        h('div', { class: 'grow' }, h('div', { class: 'name' }, t.full_name), h('div', { class: 'meta' }, t.department ?? 'No department')),
        h('b', null, `${t.points} pts`))))
      : h('p', { class: 'muted small' }, 'No ticks yet this month.'));
}

function nudgeText(name) {
  return `Hi ${firstName(name)}, hope you're well. Tti has new posts on LinkedIn and a react or comment from you would really help them reach more people. It takes a minute in TTI Amplify: ${APP_URL}`;
}

function inactiveCard(list) {
  return h('section', { class: 'card card-pad stack-s' }, h('h3', null, 'Quiet for 30 days'),
    h('p', { class: 'hint' }, 'No ticks in the last 30 days. A friendly personal message works better than a group reminder.'),
    list.length
      ? h('ul', { class: 'list' }, list.slice(0, 30).map((p) => h('li', null,
        h('span', { class: 'avatar', style: { '--c': avatarColor(p.id) } }, initials(p.full_name)),
        h('div', { class: 'grow' }, h('div', { class: 'name' }, p.full_name),
          h('div', { class: 'meta' }, `${p.department ?? 'No department'} · ${p.last_confirmed ? `last tick ${midSentence(relDate(p.last_confirmed.slice(0, 10)))}` : `joined ${midSentence(relDate(String(p.created_at).slice(0, 10)))}, no ticks yet`}`)),
        h('a', { class: 'btn btn-wa btn-sm', href: `https://wa.me/?text=${encodeURIComponent(nudgeText(p.full_name))}`, target: '_blank', rel: 'noopener noreferrer', 'aria-label': `WhatsApp nudge for ${p.full_name}` }, icon('send'), 'Nudge'))))
      : h('p', { class: 'muted small' }, 'No one is quiet. New joiners get a week before they show here.'));
}
