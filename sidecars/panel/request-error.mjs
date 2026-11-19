// Classify and sanitize the latest reported model-request error (live in-memory only).
// Never inferred from quota percentages and never persisted to history-v1 / usage-v1.

export const VISIBLE_REQUEST_ERROR_KINDS = Object.freeze([
  'quota_exhausted',
  'rate_limited',
  'network_error',
  'auth_error',
  'service_unavailable',
  'context_overflow',
  'unknown',
]);

const VISIBLE_KIND_SET = new Set(VISIBLE_REQUEST_ERROR_KINDS);

function parseDurationSeconds(value) {
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? value : null;
  if (typeof value === 'string') {
    const match = value.trim().match(/^(\d+(?:\.\d+)?)s$/i);
    if (!match) return null;
    const n = Number(match[1]);
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    if (value.seconds === undefined && value.nanos === undefined) return null;
    const whole = Number(value.seconds ?? 0);
    const nanos = Number(value.nanos ?? 0);
    if (!Number.isSafeInteger(whole) || whole < 0 || !Number.isInteger(nanos) || nanos < 0 || nanos >= 1e9) return null;
    const n = whole + nanos / 1e9;
    return Number.isFinite(n) && n > 0 ? Math.round(n * 1000) / 1000 : null;
  }
  return null;
}

export function sanitizeRequestError(raw = '') {
  const input = typeof raw === 'string' ? raw : raw == null ? '' : String(raw);
  const trimmed = input.trim();
  if (!trimmed) return '';
  return trimmed
    // Replace HTTP(S) URLs (including query params / keys) with <API>.
    .replace(/https?:\/\/[^\s"'<>]+/gi, '<API>')
    // Redact Authorization headers and Bearer/Basic tokens.
    .replace(/\b(authorization\s*[:=]\s*)(?:bearer|basic|token)\s+[^\s,;'"<>]+/gi, '$1<REDACTED>')
    .replace(/\b(bearer|basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, '$1 <REDACTED>')
    // Redact key/token/cookie/secret/password assignments.
    .replace(/\b((?:x-codeium-csrf-token|x-api-key|api[_-]?key|access[_-]?token|refresh[_-]?token|id[_-]?token|session[_-]?token|auth[_-]?token|csrf[_-]?token|set-cookie|cookie|client[_-]?secret|secret|password)\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;'"<>]+)/gi, '$1<REDACTED>')
    // Redact common provider API key prefixes.
    .replace(/\b(?:sk-(?:proj-|ant-)?[A-Za-z0-9_-]{12,}|AIza[0-9A-Za-z_-]{20,}|ya29\.[0-9A-Za-z._-]{16,}|gh[pousr]_[A-Za-z0-9_]{16,})\b/g, '<REDACTED>')
    // Redact email addresses.
    .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, '<EMAIL>')
    // Redact local absolute Windows and POSIX paths.
    .replace(/\b[A-Za-z]:\\(?:[^\s"'<>|:*?]+\\)*[^\s"'<>|:*?]*/g, '<PATH>')
    .replace(/\b[A-Za-z]:\/(?:[^\s"'<>|:*?]+\/)*[^\s"'<>|:*?]*/g, '<PATH>')
    .replace(/(^|[\s"'(=:])(?:\/(?:Users|home|var|tmp|etc|opt|root|private|Volumes|mnt|srv)\/[^\s"'<>:,;)]+)/g, '$1<PATH>')
    // Strip control / bidi override characters and flatten whitespace.
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f\u202a-\u202e\u2066-\u2069]/g, '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/ {2,}/g, ' ')
    .trim()
    .slice(0, 400);
}

export function classifyRequestError(raw = '', { retryReason = null, waitTime = null } = {}) {
  const text = (typeof raw === 'string' ? raw : raw == null ? '' : String(raw)).trim();
  const diagnostic = sanitizeRequestError(text);
  const result = (kind, retryAfterSec = null) => ({ kind, retryAfterSec, diagnostic });

  if (!text) return result('none');

  // 1. Caller-side cancellation (Go context.Canceled / user abort). Deadlines fall through below.
  if (/\bcontext cancel(?:ed|led)\b|user cancel(?:led|ed)|cancel(?:led|ed) by user|request was aborted|AbortError/i.test(text)) {
    return result('canceled');
  }

  // 2. Context window / prompt length overflow (guarded against deadline/timeout wording).
  const timeout = /context deadline exceeded|deadline exceeded|stream idle timeout/i.test(text);
  if (!timeout && /input token count(?:\s*\([^)]*\)|\s+[\d,]+)?\s+exceeds|context\s*(?:window|length|tokens?|limit|size|capacity)?.{0,35}(?:exceed|too long)|maximum context length|prompt exceeds maximum context length|prompt (?:is )?too long|max_tokens exceeded/i.test(text)) {
    return result('context_overflow');
  }

  // 3. Auth / permission failures (takes precedence over quota wording).
  if (/UNAUTHENTICATED|PERMISSION_DENIED|\b401\b|\b403\b|invalid api key|credentials expired|permission denied/i.test(text)) {
    return result('auth_error');
  }

  // 4. Upstream service unavailable / gateway / overload.
  if (/UNAVAILABLE|\b50[234]\b|server overloaded|high demand|Bad Gateway|Service Unavailable/i.test(text)) {
    return result('service_unavailable');
  }

  // 5. Network / transport / deadline failures.
  if (/\bEOF\b|idle timeout|deadline exceeded|ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|socket hang up|fetch failed|NetworkError/i.test(text)) {
    return result('network_error');
  }

  // 6. Quota exhaustion (takes precedence over rate limit).
  if (/quota\s*(?:exceeded|reached|limit|exhausted)|out\s+of\s+quota|exhausted.*(?:capacity|quota)|resource_exhausted.*(?:quota|capacity|billing)|free\s+tier\s+quota|daily\s+quota|weekly\s+quota/i.test(text)) {
    return result('quota_exhausted');
  }

  // 7. Rate limit (429) with retry-after extraction + waitTime Duration fallback.
  if (/rate\s*limit|too\s+many\s+requests|\b429\b|RateLimitError|RESOURCE_EXHAUSTED.*rate/i.test(text)) {
    const wait = text.match(/(?:retry\s+in|retry-after|wait)\s*[:=]?\s*([\d.]+)\s*(?:s|sec|seconds)?/i);
    const parsed = wait ? Number(wait[1]) : null;
    const retryAfterSec = Number.isFinite(parsed) && parsed > 0 ? parsed : parseDurationSeconds(waitTime);
    return result('rate_limited', retryAfterSec);
  }

  // 8. Fallback for any other non-empty error text (keep retryReason unused unless needed in future).
  void retryReason;
  return result('unknown');
}

export function isVisibleRequestError(err) {
  return Boolean(err && typeof err === 'object' && VISIBLE_KIND_SET.has(err.kind));
}

export function toVisibleRequestError(raw = '', opts = {}) {
  const classified = classifyRequestError(raw, opts);
  return isVisibleRequestError(classified) ? classified : null;
}

export function safeRequestError(value) {
  if (!isVisibleRequestError(value)) return null;
  const retryAfterSec = value.kind === 'rate_limited' && typeof value.retryAfterSec === 'number' && Number.isFinite(value.retryAfterSec) && value.retryAfterSec > 0
    ? value.retryAfterSec
    : null;
  const diagnostic = typeof value.diagnostic === 'string' ? sanitizeRequestError(value.diagnostic) : '';
  return { kind: value.kind, retryAfterSec, diagnostic };
}
