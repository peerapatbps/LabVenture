// Pages each role may access (null = no restriction)
export const ROLE_PAGES = {
  scientist:    null,
  operator:     ['op-dashboard', 'op-record', 'chem-intake', 'car', 'report', 'pm'],
  executive_3a: ['car', 'report', 'pm'],
  executive_3b: ['car', 'report', 'pm'],
  observer:     null,
  superadmin:   null,
};

export const PAGE_ROUTES = {
  dashboard: '/dashboard', record: '/record', 'chem-intake': '/chem-intake',
  car: '/car', report: '/report', config: '/config',
  'op-dashboard': '/op-dashboard', 'op-record': '/op-record',
  'event-class': '/event-class', pm: '/pm',
};

// Partial deploy: pages hidden from everyone except the superadmin
export const HIDDEN_PAGES = ['op-dashboard', 'op-record'];

export function isSuperBypass(me) {
  return !!me?.bypass && me?.role === 'superadmin';
}

// Superadmin = permanent superadmin account (00102616, flagged by /me) or Super Admin bypass
export function isSuperadmin(me) {
  return !!me?.is_superadmin || isSuperBypass(me);
}

// Role gate used across the client: superadmin always passes, others need their role in `roles`.
// (Callers decide separately what a null role means.)
export function hasRole(me, roles) {
  return isSuperadmin(me) || (!!me?.role && roles.includes(me.role));
}

// Page list the user may open, or null for unrestricted (superadmin: every page, hidden ones included)
export function allowedPagesFor(me) {
  if (isSuperadmin(me)) return null;
  const base = ROLE_PAGES[me?.role] ?? null;
  if (base) return base.filter(p => !HIDDEN_PAGES.includes(p));
  return Object.keys(PAGE_ROUTES).filter(p => !HIDDEN_PAGES.includes(p));
}
