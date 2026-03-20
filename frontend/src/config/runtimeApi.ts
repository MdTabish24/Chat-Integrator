const FALLBACK_API_BASE_URL = 'https://chatorbitor.onrender.com';
const DEPRECATED_HOSTS = new Set(['chat-integrator.onrender.com']);

function clean(url: string): string {
  return String(url || '').trim().replace(/\/$/, '');
}

function normalizeApiBaseUrl(rawUrl: string): string {
  const cleaned = clean(rawUrl);
  if (!cleaned) return '';

  try {
    const parsed = new URL(cleaned);
    if (DEPRECATED_HOSTS.has(parsed.hostname)) {
      if (typeof window !== 'undefined' && window.location?.origin) {
        return clean(window.location.origin);
      }
      return FALLBACK_API_BASE_URL;
    }
    return clean(parsed.toString());
  } catch (_error) {
    return '';
  }
}

export function getApiBaseUrl(): string {
  const envBase = normalizeApiBaseUrl(import.meta.env.VITE_API_BASE_URL || '');
  if (envBase) return envBase;

  if (typeof window !== 'undefined' && window.location?.origin) {
    return clean(window.location.origin);
  }

  return FALLBACK_API_BASE_URL;
}

export function getWebSocketBaseUrl(): string {
  const apiBase = getApiBaseUrl();
  return apiBase.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:');
}
