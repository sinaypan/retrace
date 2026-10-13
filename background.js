// Time tracking. Chrome's history has no notion of time spent, so we record it
// ourselves: every event (and a one-minute alarm) credits the elapsed time to
// the site that was in front of the user, then notes which site is in front now.
// State lives in chrome.storage because the service worker is killed when idle.

const ALARM = 'tick';
const IDLE_SECONDS = 60;
// Longest stretch credited in one go. Anything longer means the alarm did not
// fire (sleep, shutdown), so the time was not really spent on the page.
const MAX_GAP = 90 * 1000;
const KEEP_DAYS = 90; // same window as the history page

function hostOf(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

function timeKey(ts) {
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, '0');
  return `time:${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

async function activeHost() {
  const state = await chrome.idle.queryState(IDLE_SECONDS);
  if (state === 'locked') return null;
  const win = await chrome.windows.getLastFocused().catch(() => null);
  if (!win || !win.focused) return null;
  const [tab] = await chrome.tabs.query({ active: true, windowId: win.id });
  if (!tab) return null;
  // No input for a minute only counts if something is playing (a video).
  if (state === 'idle' && !tab.audible) return null;
  return hostOf(tab.url);
}

async function timeKeys() {
  return Object.keys(await chrome.storage.local.get(null)).filter((key) => key.startsWith('time:'));
}

// Time counts are kept as long as the history page can show them, no longer.
async function purgeOldTime() {
  const oldest = timeKey(Date.now() - KEEP_DAYS * 24 * 60 * 60 * 1000);
  const old = (await timeKeys()).filter((key) => key < oldest);
  if (old.length) await chrome.storage.local.remove(old);
}

// What leaves the history leaves the time counts too. A count belongs to a
// site and a day, not to a page, so a site is forgotten once none of its pages
// is left in the history.
async function forgetRemoved({ allHistory, urls = [] }) {
  if (allHistory) {
    await chrome.storage.local.remove(await timeKeys());
    return;
  }
  const gone = [];
  for (const host of new Set(urls.map(hostOf).filter(Boolean))) {
    const items = await chrome.history.search({ text: host, startTime: 0, maxResults: 1000 });
    if (!items.some((item) => hostOf(item.url) === host)) gone.push(host);
  }
  if (!gone.length) return;
  const days = await chrome.storage.local.get(await timeKeys());
  const update = {};
  const emptied = [];
  for (const [key, day] of Object.entries(days)) {
    if (!gone.some((host) => host in day)) continue;
    for (const host of gone) delete day[host];
    if (Object.keys(day).length) update[key] = day;
    else emptied.push(key);
  }
  await chrome.storage.local.set(update);
  await chrome.storage.local.remove(emptied);
}

async function tick() {
  const now = Date.now();
  const { current } = await chrome.storage.local.get('current');
  // First tick of a new day: drop the days that fell out of the window.
  if (current && timeKey(current.last) !== timeKey(now)) await purgeOldTime();
  const update = {};
  if (current?.host) {
    const delta = Math.min(now - current.last, MAX_GAP);
    if (delta > 0) {
      const key = timeKey(current.last);
      const { [key]: day = {} } = await chrome.storage.local.get(key);
      day[current.host] = (day[current.host] || 0) + delta;
      update[key] = day;
    }
  }
  update.current = { host: await activeHost(), last: now };
  await chrome.storage.local.set(update);
}

// Events can arrive together; run ticks one at a time so none is counted twice.
let queue = Promise.resolve();
function schedule() {
  queue = queue.then(tick).catch(console.error);
}

async function ensureAlarm() {
  if (!(await chrome.alarms.get(ALARM))) {
    chrome.alarms.create(ALARM, { periodInMinutes: 1 });
  }
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.idle.setDetectionInterval(IDLE_SECONDS);
  ensureAlarm();
  queue = queue.then(purgeOldTime).catch(console.error);
  schedule();
});

chrome.runtime.onStartup.addListener(() => {
  chrome.idle.setDetectionInterval(IDLE_SECONDS);
  ensureAlarm();
  // Whatever was in front when Chrome closed is not in front anymore.
  queue = queue.then(() => chrome.storage.local.remove('current')).catch(console.error);
  queue = queue.then(purgeOldTime).catch(console.error);
  schedule();
});

// In the same queue as the ticks, which rewrite the same records.
chrome.history.onVisitRemoved.addListener((removed) => {
  queue = queue.then(() => forgetRemoved(removed)).catch(console.error);
});

chrome.alarms.onAlarm.addListener(schedule);
chrome.tabs.onActivated.addListener(schedule);
chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (change.url !== undefined || change.audible !== undefined) schedule();
});
chrome.windows.onFocusChanged.addListener(schedule);
chrome.idle.onStateChanged.addListener(schedule);

chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: 'chrome://history' });
});
