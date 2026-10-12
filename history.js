const MAX_DAYS = 90; // Chrome keeps about three months of history
const SITE_LIMIT = 8;
const PAGE_LIMIT = 8;
const SEARCH_LIMIT = 100;

const lang = navigator.language.startsWith('fr') ? 'fr' : 'en';
const plural = (n, one, many) => `${n} ${(lang === 'fr' ? n < 2 : n === 1) ? one : many}`;

const STRINGS = {
  en: {
    title: 'History',
    sortLabel: 'Sort sites by',
    sortTime: 'Time',
    sortRecent: 'Recent',
    search: 'Search history',
    today: 'Today',
    yesterday: 'Yesterday',
    statTime: 'Time today',
    statSites: 'Sites',
    statPages: 'Pages',
    pages: (n) => plural(n, 'page', 'pages'),
    sites: (n) => plural(n, 'site', 'sites'),
    visits: (n) => plural(n, 'visit', 'visits'),
    cookies: (n) => plural(n, 'cookie', 'cookies'),
    lastAt: (time) => `last at ${time}`,
    perPage: (duration) => `${duration} per page`,
    visitsOverall: (n) => `${plural(n, 'visit', 'visits')} overall`,
    moreSites: (n) => `Show ${plural(n, 'more site', 'more sites')}`,
    morePages: (n) => `Show ${plural(n, 'more page', 'more pages')}`,
    clearCookies: 'Clear cookies',
    confirmClear: (n) => `Clear ${plural(n, 'cookie', 'cookies')}?`,
    remove: 'Remove from history',
    empty: 'Your browsing will show up here.',
    noResults: 'No pages match that search.',
  },
  fr: {
    title: 'Historique',
    sortLabel: 'Trier les sites par',
    sortTime: 'Temps',
    sortRecent: 'Récent',
    search: 'Rechercher dans l’historique',
    today: 'Aujourd’hui',
    yesterday: 'Hier',
    statTime: 'Temps aujourd’hui',
    statSites: 'Sites',
    statPages: 'Pages',
    pages: (n) => plural(n, 'page', 'pages'),
    sites: (n) => plural(n, 'site', 'sites'),
    visits: (n) => plural(n, 'visite', 'visites'),
    cookies: (n) => plural(n, 'cookie', 'cookies'),
    lastAt: (time) => `dernière à ${time}`,
    perPage: (duration) => `${duration} par page`,
    visitsOverall: (n) => `${plural(n, 'visite', 'visites')} au total`,
    moreSites: (n) => `Afficher ${plural(n, 'autre site', 'autres sites')}`,
    morePages: (n) => `Afficher ${plural(n, 'autre page', 'autres pages')}`,
    clearCookies: 'Effacer les cookies',
    confirmClear: (n) => `Effacer ${plural(n, 'cookie', 'cookies')} ?`,
    remove: 'Retirer de l’historique',
    empty: 'Votre navigation apparaîtra ici.',
    noResults: 'Aucune page ne correspond à cette recherche.',
  },
};
const t = STRINGS[lang];

const $ = (selector) => document.querySelector(selector);

function el(tag, props, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (key === 'class') node.className = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else if (value === true) node.setAttribute(key, '');
    else if (value !== false && value != null) node.setAttribute(key, value);
  }
  node.append(...children.filter((child) => child != null && child !== false));
  return node;
}

// ---------- formatting ----------

function fmtDuration(ms) {
  const minutes = Math.round(ms / 60000);
  if (minutes < 1) return ms > 0 ? '<1m' : '0m';
  const hours = Math.floor(minutes / 60);
  return hours ? `${hours}h ${minutes % 60}m` : `${minutes}m`;
}

function fmtClock(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function startOfDay(daysAgo) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - daysAgo);
  return d.getTime();
}

function endOfDay(start) {
  const d = new Date(start);
  d.setDate(d.getDate() + 1);
  return d.getTime();
}

function dayLabel(start) {
  if (start === startOfDay(0)) return t.today;
  if (start === startOfDay(1)) return t.yesterday;
  const label = new Date(start).toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

// Same key format as background.js.
function timeKey(start) {
  const d = new Date(start);
  const pad = (n) => String(n).padStart(2, '0');
  return `time:${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function hostOf(url) {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, '') || u.protocol.slice(0, -1);
  } catch {
    return url;
  }
}

function favicon(url, host) {
  const src = new URL(chrome.runtime.getURL('/_favicon/'));
  src.searchParams.set('pageUrl', url);
  src.searchParams.set('size', '32');
  const img = el('img', { class: 'favicon', src: src.href, alt: '' });
  img.addEventListener('error', () => {
    img.replaceWith(el('span', { class: 'favicon letter' }, host.charAt(0).toUpperCase()));
  }, { once: true });
  return img;
}

function chevron() {
  const span = el('span', { class: 'chevron', 'aria-hidden': 'true' });
  span.innerHTML = '<svg viewBox="0 0 16 16"><path d="m6 3.5 4.5 4.5L6 12.5"/></svg>';
  return span;
}

// Extension pages cannot follow links to file:// or chrome:// URLs themselves.
function pageLink(url, props, ...children) {
  return el('a', {
    ...props,
    href: url,
    onclick: (event) => {
      if (/^https?:/.test(url)) return;
      event.preventDefault();
      chrome.tabs.create({ url });
    },
  }, ...children);
}

// ---------- data ----------

const visitCache = new Map(); // url -> Promise<visit timestamps>
const metaCache = new Map(); // host -> Promise<{ cookies, visits }>

function visitsOf(url) {
  if (!visitCache.has(url)) {
    visitCache.set(url, chrome.history.getVisits({ url }).then((visits) => visits.map((v) => v.visitTime)));
  }
  return visitCache.get(url);
}

// history.search returns one entry per URL with its overall last visit, so the
// visits that actually fall inside the day come from getVisits.
async function loadDay(start) {
  const end = endOfDay(start);
  const key = timeKey(start);
  const [items, { [key]: time = {} }] = await Promise.all([
    chrome.history.search({ text: '', startTime: start, endTime: end, maxResults: 5000 }),
    chrome.storage.local.get(key),
  ]);

  const sites = new Map();
  await Promise.all(items.map(async (item) => {
    const times = (await visitsOf(item.url)).filter((ts) => ts >= start && ts < end);
    if (!times.length) return;
    const host = hostOf(item.url);
    if (!sites.has(host)) sites.set(host, { host, pages: [], visits: 0, last: 0, time: time[host] || 0 });
    const site = sites.get(host);
    const last = Math.max(...times);
    site.pages.push({ url: item.url, title: item.title, last, visits: times.length });
    site.visits += times.length;
    site.last = Math.max(site.last, last);
  }));

  for (const site of sites.values()) site.pages.sort((a, b) => b.last - a.last);
  const total = Object.values(time).reduce((sum, ms) => sum + ms, 0);
  return { sites: [...sites.values()], total };
}

function siteMeta(host) {
  if (!metaCache.has(host)) {
    metaCache.set(host, (async () => {
      const [cookies, items] = await Promise.all([
        chrome.cookies.getAll({ domain: host }),
        chrome.history.search({ text: host, startTime: 0, maxResults: 1000 }),
      ]);
      const visits = items
        .filter((item) => hostOf(item.url) === host)
        .reduce((sum, item) => sum + (item.visitCount || 0), 0);
      return { cookies, visits };
    })());
  }
  return metaCache.get(host);
}

function removeCookies(cookies) {
  return Promise.all(cookies.map((cookie) => chrome.cookies.remove({
    url: `http${cookie.secure ? 's' : ''}://${cookie.domain.replace(/^\./, '')}${cookie.path}`,
    name: cookie.name,
    storeId: cookie.storeId,
  })));
}

// ---------- day view ----------

const days = []; // loaded days, newest first
let sort = localStorage.getItem('sort') === 'recent' ? 'recent' : 'time';
let cursor = 0; // next day to load, in days before today
let loading = false;

function newDay(start, data) {
  return { start, data, expanded: new Set(), allPages: new Set(), allSites: false, el: el('section', { class: 'day' }) };
}

function sortSites(sites) {
  const byTime = (a, b) => b.time - a.time || b.visits - a.visits || b.last - a.last;
  const byRecent = (a, b) => b.last - a.last;
  return [...sites].sort(sort === 'recent' ? byRecent : byTime);
}

function renderDay(day) {
  const sites = sortSites(day.data.sites);
  const hasTime = sites.some((site) => site.time > 0);
  const max = Math.max(1, ...sites.map((site) => (hasTime ? site.time : site.visits)));
  const shown = day.allSites ? sites : sites.slice(0, SITE_LIMIT);

  const card = el('div', { class: 'card' });
  for (const site of shown) card.append(...siteRow(day, site, hasTime, max));
  if (sites.length > shown.length) {
    card.append(el('button', {
      class: 'more',
      type: 'button',
      onclick: () => { day.allSites = true; renderDay(day); },
    }, t.moreSites(sites.length - shown.length)));
  }

  const meta = [day.data.total > 0 && fmtDuration(day.data.total), t.sites(sites.length)].filter(Boolean).join(' · ');
  day.el.replaceChildren(
    el('h2', null, el('span', null, dayLabel(day.start)), el('span', { class: 'day-meta' }, meta)),
    card,
  );
}

function siteRow(day, site, hasTime, max) {
  const open = day.expanded.has(site.host);
  const fill = el('span');
  fill.style.width = `${Math.round(((hasTime ? site.time : site.visits) / max) * 100)}%`;

  const row = el('button', {
    class: 'site',
    type: 'button',
    'aria-expanded': String(open),
    onclick: () => {
      if (open) day.expanded.delete(site.host);
      else day.expanded.add(site.host);
      renderDay(day);
    },
  },
    favicon(site.pages[0].url, site.host),
    el('span', { class: 'site-text' },
      el('span', { class: 'site-name' }, site.host),
      el('span', { class: 'site-sub' }, `${t.pages(site.pages.length)} · ${t.lastAt(fmtClock(site.last))}`)),
    el('span', { class: 'bar' }, fill),
    el('span', { class: site.time ? 'site-value' : 'site-value muted' },
      site.time ? fmtDuration(site.time) : t.visits(site.visits)),
    chevron(),
  );
  return open ? [row, siteDetail(day, site)] : [row];
}

function siteDetail(day, site) {
  const overall = el('span');
  const cookies = el('span');
  const clear = el('button', { class: 'link', type: 'button', hidden: true }, t.clearCookies);
  const meta = el('div', { class: 'meta' },
    site.time > 0 && el('span', null, t.perPage(fmtDuration(site.time / site.visits))),
    overall, cookies, clear);

  siteMeta(site.host).then((info) => {
    overall.textContent = t.visitsOverall(info.visits);
    cookies.textContent = t.cookies(info.cookies.length);
    clear.hidden = info.cookies.length === 0;
  });

  // First click asks, second click clears.
  let armed = false;
  clear.addEventListener('click', async () => {
    const info = await siteMeta(site.host);
    if (!armed) {
      armed = true;
      clear.textContent = t.confirmClear(info.cookies.length);
      clear.classList.add('danger');
      return;
    }
    await removeCookies(info.cookies);
    metaCache.delete(site.host);
    renderDay(day);
  });

  const showAll = day.allPages.has(site.host);
  const pages = showAll ? site.pages : site.pages.slice(0, PAGE_LIMIT);
  const list = el('ul', { class: 'pages' }, ...pages.map((page) => el('li', null,
    pageLink(page.url, { title: page.url }, page.title || page.url),
    el('time', null, fmtClock(page.last)),
    el('button', {
      class: 'remove',
      type: 'button',
      title: t.remove,
      'aria-label': t.remove,
      onclick: () => removePage(day, site.host, page.url),
    }, '×'))));

  const more = site.pages.length > pages.length && el('button', {
    class: 'link',
    type: 'button',
    onclick: () => { day.allPages.add(site.host); renderDay(day); },
  }, t.morePages(site.pages.length - pages.length));

  return el('div', { class: 'detail' }, meta, list, more);
}

// deleteUrl removes every visit to the page, not only this day's.
async function removePage(day, host, url) {
  await chrome.history.deleteUrl({ url });
  visitCache.delete(url);
  metaCache.delete(host);
  day.data = await loadDay(day.start);
  if (day.data.sites.length) {
    renderDay(day);
  } else {
    day.el.remove();
    days.splice(days.indexOf(day), 1);
  }
  if (day.start === startOfDay(0)) renderSummary(day.data);
  updateEmpty();
}

function renderSummary(data) {
  const pages = data.sites.reduce((sum, site) => sum + site.pages.length, 0);
  $('[data-stat="time"]').textContent = fmtDuration(data.total);
  $('[data-stat="sites"]').textContent = data.sites.length;
  $('[data-stat="pages"]').textContent = pages;
}

function sentinelVisible() {
  return $('#sentinel').getBoundingClientRect().top < window.innerHeight + 400;
}

// Loads older days until the screen is filled, skipping days with no visits.
async function loadMore() {
  if (loading || searching()) return;
  loading = true;
  try {
    while (cursor < MAX_DAYS && sentinelVisible()) {
      const start = startOfDay(cursor);
      const data = await loadDay(start);
      if (cursor === 0) renderSummary(data);
      cursor += 1;
      if (!data.sites.length) continue;
      const day = newDay(start, data);
      days.push(day);
      renderDay(day);
      $('#days').append(day.el);
    }
  } finally {
    loading = false;
    updateEmpty();
  }
}

// Picks up what was browsed (and tracked) while this tab was in the background.
async function refreshToday() {
  if (loading || searching()) return;
  loading = true;
  try {
    visitCache.clear();
    metaCache.clear();
    const start = startOfDay(0);
    const data = await loadDay(start);
    renderSummary(data);
    let day = days.find((d) => d.start === start);
    if (day) {
      day.data = data;
    } else if (data.sites.length) {
      day = newDay(start, data);
      days.unshift(day);
      $('#days').prepend(day.el);
    }
    for (const d of days) renderDay(d);
  } finally {
    loading = false;
    updateEmpty();
  }
}

// ---------- search ----------

const searching = () => $('#search').value.trim() !== '';
let searchToken = 0;

async function runSearch() {
  const query = $('#search').value.trim();
  const token = ++searchToken;
  const active = query !== '';
  $('#summary').hidden = active;
  $('#days').hidden = active;
  $('#sentinel').hidden = active;
  $('#results').hidden = !active;
  if (!active) {
    $('#results').replaceChildren();
    updateEmpty();
    loadMore();
    return;
  }

  const items = await chrome.history.search({ text: query, startTime: 0, maxResults: SEARCH_LIMIT });
  if (token !== searchToken) return;
  const rows = items.map((item) => {
    const host = hostOf(item.url);
    const when = new Date(item.lastVisitTime).toLocaleString([], {
      day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
    });
    return pageLink(item.url, { class: 'result', title: item.url },
      favicon(item.url, host),
      el('span', { class: 'site-text' },
        el('span', { class: 'site-name' }, item.title || item.url),
        el('span', { class: 'site-sub' }, `${host} · ${when}`)));
  });
  $('#results').replaceChildren(...(rows.length ? [el('div', { class: 'card' }, ...rows)] : []));
  updateEmpty(rows.length === 0);
}

function updateEmpty(noResults = false) {
  const empty = $('#empty');
  if (searching()) {
    empty.textContent = t.noResults;
    empty.hidden = !noResults;
  } else {
    empty.textContent = t.empty;
    empty.hidden = loading || days.length > 0;
  }
}

// ---------- init ----------

function renderSort() {
  for (const button of document.querySelectorAll('#sort button')) {
    button.setAttribute('aria-pressed', String(button.dataset.sort === sort));
  }
}

document.documentElement.lang = lang;
document.title = t.title;
$('#title').textContent = t.title;
$('#search').placeholder = t.search;
$('#search').setAttribute('aria-label', t.search);
$('#sort').setAttribute('aria-label', t.sortLabel);
$('[data-sort="time"]').textContent = t.sortTime;
$('[data-sort="recent"]').textContent = t.sortRecent;
$('[data-label="time"]').textContent = t.statTime;
$('[data-label="sites"]').textContent = t.statSites;
$('[data-label="pages"]').textContent = t.statPages;
$('#summary').hidden = false;
renderSort();

$('#sort').addEventListener('click', (event) => {
  const next = event.target.dataset.sort;
  if (!next || next === sort) return;
  sort = next;
  localStorage.setItem('sort', sort);
  renderSort();
  for (const day of days) renderDay(day);
});

let searchTimer;
$('#search').addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(runSearch, 150);
});

document.addEventListener('keydown', (event) => {
  const input = $('#search');
  if (event.key === '/' && document.activeElement !== input) {
    event.preventDefault();
    input.focus();
  } else if (event.key === 'Escape' && input.value) {
    input.value = '';
    runSearch();
  }
});

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) refreshToday();
});

new IntersectionObserver(loadMore, { rootMargin: '400px' }).observe($('#sentinel'));
loadMore();
