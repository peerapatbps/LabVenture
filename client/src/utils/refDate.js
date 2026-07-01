const COOKIE_KEY = 'reference_date';

function todayStr() {
  // Thai time UTC+7
  const d = new Date(Date.now() + 7 * 60 * 60 * 1000);
  return d.toISOString().split('T')[0];
}

export function getRefDate() {
  const m = document.cookie.match(/(?:^|;\s*)reference_date=([^;]+)/);
  return m ? m[1] : todayStr();
}

export function setRefDate(date) {
  const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toUTCString();
  document.cookie = `${COOKIE_KEY}=${date}; path=/; expires=${expires}`;
}
