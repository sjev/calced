// Date values and date arithmetic. No Big, no DOM.

// --- Date/time support ---
const ISO_DATE_JS_RE = /^\d{4}-\d{2}-\d{2}/;
const DATE_KEYWORDS = new Set(["today", "tomorrow", "yesterday"]);
const DURATION_UNITS = new Set(["day", "days", "week", "weeks", "month", "months", "year", "years"]);

function _makeDate(y, m, d) { return { _isDate: true, y, m, d }; }
function _dateToISO(dt) {
  const yy = String(dt.y).padStart(4, '0');
  const mm = String(dt.m).padStart(2, '0');
  const dd = String(dt.d).padStart(2, '0');
  return yy + '-' + mm + '-' + dd;
}
function _dateFromISO(s) {
  const parts = s.split('-');
  const y = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  const d = parseInt(parts[2], 10);
  // Validate
  if (m < 1 || m > 12 || d < 1 || d > _daysInMonth(y, m)) return null;
  return _makeDate(y, m, d);
}
function _isDateObj(v) { return v && v._isDate === true; }
function _daysInMonth(y, m) {
  return new Date(y, m, 0).getDate();
}
function _todayDate() {
  const now = new Date();
  return _makeDate(now.getFullYear(), now.getMonth() + 1, now.getDate());
}
function _resolveDateKeyword(kw) {
  const t = _todayDate();
  if (kw === "today") return t;
  if (kw === "tomorrow") return _dateAddDays(t, 1);
  if (kw === "yesterday") return _dateAddDays(t, -1);
  return null;
}
function _dateToJSDate(dt) { return new Date(dt.y, dt.m - 1, dt.d); }
function _jsDateToDate(jsd) { return _makeDate(jsd.getFullYear(), jsd.getMonth() + 1, jsd.getDate()); }
function _dateAddDays(dt, n) {
  const jsd = _dateToJSDate(dt);
  jsd.setDate(jsd.getDate() + n);
  return _jsDateToDate(jsd);
}
function _dateAddMonths(dt, months) {
  let m = dt.m - 1 + months;
  let y = dt.y + Math.floor(m / 12);
  m = ((m % 12) + 12) % 12 + 1;
  const maxDay = _daysInMonth(y, m);
  return _makeDate(y, m, Math.min(dt.d, maxDay));
}
function _dateDiffDays(d1, d2) {
  const ms = _dateToJSDate(d1).getTime() - _dateToJSDate(d2).getTime();
  return Math.round(ms / 86400000);
}

export {
  ISO_DATE_JS_RE, DATE_KEYWORDS, DURATION_UNITS,
  _makeDate, _dateToISO, _dateFromISO, _isDateObj, _daysInMonth, _todayDate,
  _resolveDateKeyword, _dateToJSDate, _jsDateToDate,
  _dateAddDays, _dateAddMonths, _dateDiffDays,
};
