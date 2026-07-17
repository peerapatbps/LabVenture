/** Read the BellBeast bypass role from the shared cookie. Returns null when no bypass is active. */
export function getBypassRole() {
  const m = document.cookie.match('(^|;)\\s*bb_bypass_role\\s*=\\s*([^;]+)');
  return m ? decodeURIComponent(m[2]) : null;
}

/**
 * Returns true when the action is allowed.
 * - No bypass active  → always allowed.
 * - Bypass active     → allowed only if role is in allowedRoles.
 */
export function canDoAction(bypassRole, allowedRoles) {
  if (!bypassRole) return true;
  return allowedRoles.includes(bypassRole);
}
