// Next may use an internal hostname in request.url. Host preserves the public
// request host on localhost and Vercel, without trusting a caller-provided origin.
export function sameOrigin(request: Request) {
  const origin = request.headers.get('origin');
  if (!origin) return false;
  try {
    const parsed = new URL(origin);
    const host = request.headers.get('host') || new URL(request.url).host;
    const protocol = request.headers.get('x-forwarded-proto') || new URL(request.url).protocol.replace(':','');
    return parsed.host === host && parsed.protocol === protocol + ':';
  } catch { return false; }
}
