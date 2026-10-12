// Time tracking. Chrome's history has no notion of time spent, so we record it
// ourselves: every event (and a one-minute alarm) credits the elapsed time to
// the site that was in front of the user, then notes which site is in front now.
// State lives in chrome.storage because the service worker is killed when idle.

const ALARM = 'tick';
const IDLE_SECONDS = 60;
// Longest stretch credited in one go. Anything longer means the alarm did not
// fire (sleep, shutdown), so the time was not really spent on the page.
const MAX_GAP = 90 * 1000;

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

async function tick() {
  const now = Date.now();
  const { current } = await chrome.storage.local.get('current');
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
  schedule();
});

chrome.runtime.onStartup.addListener(() => {
  chrome.idle.setDetectionInterval(IDLE_SECONDS);
  ensureAlarm();
  // Whatever was in front when Chrome closed is not in front anymore.
  queue = queue.then(() => chrome.storage.local.remove('current')).catch(console.error);
  schedule();
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
