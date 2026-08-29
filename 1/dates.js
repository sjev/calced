// Date and datetime values, and date arithmetic. No Big, no DOM.
//
// One record type carries both, mirroring Python where `datetime` subclasses
// `date`: `hasTime` is the only thing that tells them apart. Arithmetic runs in
// UTC, because a local-time day is 23 or 25 hours long across a DST switch and
// that would corrupt any result measured in hours.

// --- Date/time support ---
const ISO_DATE_JS_RE = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/;
const DURATION_UNITS = new Set([
  "second", "seconds", "minute", "minutes", "hour", "hours",
  "day", "days", "week", "weeks", "month", "months", "year", "years",
]);
// Time-valued units promote a plain date to a datetime.
const TIME_UNIT_SECONDS = {
  second: 1, seconds: 1, minute: 60, minutes: 60, hour: 3600, hours: 3600,
};
// Units that "days until X" can be counted in.
const UNTIL_UNIT_SECONDS = { hours: 3600, days: 86400, weeks: 604800 };

function _makeDate(y, m, d, hh, mi, ss, hasTime) {
  return { _isDate: true, y, m, d, hh: hh || 0, mi: mi || 0, ss: ss || 0, hasTime: !!hasTime };
}
function _pad(n, w) { return String(n).padStart(w, '0'); }
function _dateToISO(dt) {
  const day = _pad(dt.y, 4) + '-' + _pad(dt.m, 2) + '-' + _pad(dt.d, 2);
  if (!dt.hasTime) return day;
  const time = _pad(dt.hh, 2) + ':' + _pad(dt.mi, 2);
  // Seconds show only when they carry information, so that a Python `datetime`
  // — which cannot remember whether the literal had them — renders the same.
  return day + ' ' + time + (dt.ss ? ':' + _pad(dt.ss, 2) : '');
}
// Parse an ISO date with an optional time. Returns [value, length] or null.
// A time only counts when it follows a date, so a bare "18:00" in a note is
// never read as a value. An out-of-range time degrades to the date alone.
function _parseISO(s) {
  const m = s.match(ISO_DATE_JS_RE);
  if (!m) return null;
  const y = parseInt(m[1], 10), mo = parseInt(m[2], 10), d = parseInt(m[3], 10);
  if (mo < 1 || mo > 12 || d < 1 || d > _daysInMonth(y, mo)) return null;
  const dateLen = m[1].length + m[2].length + m[3].length + 2;
  if (m[4] === undefined) return [_makeDate(y, mo, d), dateLen];
  const hh = parseInt(m[4], 10), mi = parseInt(m[5], 10), ss = parseInt(m[6] || "0", 10);
  if (hh > 23 || mi > 59 || ss > 59) return [_makeDate(y, mo, d), dateLen];
  return [_makeDate(y, mo, d, hh, mi, ss, true), m[0].length];
}
function _isDateObj(v) { return v && v._isDate === true; }
function _isDateTimeObj(v) { return _isDateObj(v) && v.hasTime; }
function _daysInMonth(y, m) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}
function _todayDate() {
  // "Today" is the viewer's wall clock, so this one stays local.
  const now = new Date();
  return _makeDate(now.getFullYear(), now.getMonth() + 1, now.getDate());
}
function _nowValue() {
  const now = new Date();
  return _makeDate(now.getFullYear(), now.getMonth() + 1, now.getDate(),
                   now.getHours(), now.getMinutes(), now.getSeconds(), true);
}
function _dateToJSDate(dt) { return new Date(Date.UTC(dt.y, dt.m - 1, dt.d, dt.hh, dt.mi, dt.ss)); }
function _jsDateToDate(jsd, hasTime) {
  return _makeDate(jsd.getUTCFullYear(), jsd.getUTCMonth() + 1, jsd.getUTCDate(),
                   jsd.getUTCHours(), jsd.getUTCMinutes(), jsd.getUTCSeconds(), hasTime);
}
function _dateAddDays(dt, n) {
  const jsd = _dateToJSDate(dt);
  jsd.setUTCDate(jsd.getUTCDate() + n);
  return _jsDateToDate(jsd, dt.hasTime);
}
function _dateAddSeconds(dt, n) {
  const jsd = new Date(_dateToJSDate(dt).getTime() + n * 1000);
  return _jsDateToDate(jsd, true);
}
function _dateAddMonths(dt, months) {
  let m = dt.m - 1 + months;
  let y = dt.y + Math.floor(m / 12);
  m = ((m % 12) + 12) % 12 + 1;
  const maxDay = _daysInMonth(y, m);
  return _makeDate(y, m, Math.min(dt.d, maxDay), dt.hh, dt.mi, dt.ss, dt.hasTime);
}
function _dateDiffDays(d1, d2) {
  const ms = _dateToJSDate(d1).getTime() - _dateToJSDate(d2).getTime();
  return Math.round(ms / 86400000);
}
function _dateDiffSeconds(d1, d2) {
  return Math.round((_dateToJSDate(d1).getTime() - _dateToJSDate(d2).getTime()) / 1000);
}

export {
  ISO_DATE_JS_RE, DURATION_UNITS, TIME_UNIT_SECONDS, UNTIL_UNIT_SECONDS,
  _makeDate, _dateToISO, _parseISO, _isDateObj, _isDateTimeObj, _daysInMonth,
  _todayDate, _nowValue, _dateToJSDate, _jsDateToDate,
  _dateAddDays, _dateAddSeconds, _dateAddMonths, _dateDiffDays, _dateDiffSeconds,
};
