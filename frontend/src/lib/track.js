// First-party tap counters for the home page (see backend app/home_events.py): no cookies, no ids, no third
// parties. Fire-and-forget; a failed count never bothers the person.
import { API_BASE, LIVE } from '../services/http';

export function track(name) {
  if (!LIVE || typeof fetch === 'undefined') return;
  try {
    fetch(`${API_BASE}/api/public/events`, {
      method: 'POST',
      credentials: 'omit', // no cookies: the count can't be tied to anyone
      keepalive: true, // still sent when the tap navigates away
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    }).catch(() => {});
  } catch { /* ignore */ }
}
