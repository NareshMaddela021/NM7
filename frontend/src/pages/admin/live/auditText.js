// Audit log "Details" as readable text instead of raw JSON:
// {"via":"totp","trust":false} → "via: authenticator app · trusted device: no"
const LABEL = { trust: 'trusted device', payment_id: 'payment', paymentId: 'payment', order_id: 'order', orderId: 'order', delivery_hours: 'delivery hours', deliveryHours: 'delivery hours' };
const VALUE = { via: { totp: 'authenticator app', recovery_code: 'recovery code', trusted_device: 'trusted device' } };
const words = (k) => LABEL[k] || k.replace(/^(plans|addons)\./, '').replace(/[_.]/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();

function val(k, v) {
  if (v === true) return 'yes';
  if (v === false) return 'no';
  if (v === null || v === undefined || v === '') return '—';
  if (Array.isArray(v)) return v.map((x) => val(k, x)).join(', ');
  if (typeof v === 'object') {
    if ('from' in v && 'to' in v) return `${val(k, v.from)} → ${val(k, v.to)}`; // a change
    if ('amount' in v) return `₹${v.amount}${v.active === false ? ' (off)' : ''}`; // a price
    return Object.entries(v).map(([kk, vv]) => `${words(kk)} ${val(kk, vv)}`).join(', ');
  }
  return VALUE[k]?.[v] || String(v);
}

/** "key: value · key: value" (empty string when there's nothing). */
export function auditText(data) {
  return Object.entries(data || {}).map(([k, v]) => `${words(k)}: ${val(k, v)}`).join(' · ');
}
