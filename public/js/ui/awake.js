// Keep the screen on while a rest or set timer runs (§20.2): one screen wake lock, held while `wanted()` says so and
// the page is visible, released as soon as it doesn't. The browser drops the lock whenever the page is hidden, so it is
// asked for again when the page shows. No Wake Lock API, or a refusal (NotAllowedError, …) → nothing happens, silently.
// app.js calls `syncAwake()` after every state change and every redraw; when nothing changed, the lock is left alone.

/** While a lock is held, how often `wanted()` is asked again (a timer older than 4 hours stops without a state change). */
const RECHECK_MS = 60 * 1000;

const lock = {
  wanted: () => false, // set by `watchAwake`
  sentinel: null, // the WakeLockSentinel held now
  asking: false, // a request is on its way
  recheck: 0,
};

/** True when this browser has the Screen Wake Lock API. */
export function canKeepAwake() {
  return typeof navigator !== 'undefined' && Boolean(navigator.wakeLock) && typeof navigator.wakeLock.request === 'function';
}

const visible = () => document.visibilityState === 'visible';

function release() {
  const held = lock.sentinel;
  lock.sentinel = null;
  clearInterval(lock.recheck);
  lock.recheck = 0;
  try { held.release().catch(() => {}); } catch { /* already gone */ }
}

async function request() {
  lock.asking = true;
  let got = null;
  try {
    got = await navigator.wakeLock.request('screen');
  } catch {
    got = null; // refused (not visible, battery saver, not allowed): the screen just sleeps as usual
  }
  lock.asking = false;
  if (!got) return;
  lock.sentinel = got;
  // The browser lets go by itself (page hidden): forget it, so becoming visible asks again.
  got.addEventListener('release', () => {
    if (lock.sentinel !== got) return;
    lock.sentinel = null;
    clearInterval(lock.recheck);
    lock.recheck = 0;
  });
  lock.recheck = setInterval(syncAwake, RECHECK_MS);
  syncAwake(); // things may have changed while asking (Skip tapped, page hidden)
}

/**
 * Hold or release the lock to match `wanted()` and the page's visibility. A lock already held, or one on its way, is
 * left as it is while it is still wanted.
 */
export function syncAwake() {
  if (!canKeepAwake()) return;
  let want = false;
  try { want = visible() && Boolean(lock.wanted()); } catch { want = false; }
  if (want && !lock.sentinel && !lock.asking) request();
  else if (!want && lock.sentinel) release();
}

/**
 * Start keeping the screen on whenever `wanted()` is true (once, at boot).
 * @param {() => boolean} wanted
 */
export function watchAwake(wanted) {
  lock.wanted = wanted;
  document.addEventListener('visibilitychange', syncAwake);
  syncAwake();
}
