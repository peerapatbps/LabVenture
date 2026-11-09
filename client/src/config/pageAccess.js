// Pages each role may access (null = no restriction)
export const ROLE_PAGES = {
  scientist:    null,
  operator:     ['op-dashboard', 'op-record', 'chem-intake', 'car', 'report'],
  executive_3a: ['car', 'report'],
  executive_3b: ['car', 'report'],
  observer:     null,
  superadmin:   null,
};

export const PAGE_ROUTES = {
  dashboard: '/dashboard', record: '/record', 'chem-intake': '/chem-intake',
  car: '/car', report: '/report', config: '/config',
  'op-dashboard': '/op-dashboard', 'op-record': '/op-record',
  'event-class': '/event-class',
};

// Partial deploy: pages hidden from everyone except the superadmin
export const HIDDEN_PAGES = ['car', 'report', 'event-class'];

// Operator-only pages: never part of the "unrestricted" set (scientist / observer / no role)
export const OPERATOR_ONLY_PAGES = ['op-dashboard', 'op-record'];

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
  return Object.keys(PAGE_ROUTES).filter(p => !HIDDEN_PAGES.includes(p) && !OPERATOR_ONLY_PAGES.includes(p));
}

// Can this user open `page`? Use it to hide in-page links (e.g. "ไปออก CAR") to pages they can't reach.
export function canOpenPage(me, page) {
  const allowed = allowedPagesFor(me);
  return !allowed || allowed.includes(page);
}
