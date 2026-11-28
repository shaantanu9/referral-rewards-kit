import { formatCode, isWellFormedCode, normaliseCode } from './code-format';

/**
 * What the code field shows after a paste, exactly as the Flutter entry does: `formatCode(normaliseCode(text))`.
 */
export const pastedCodeText = (text: string): string => formatCode(normaliseCode(text));

/**
 * The invite code inside pasted text, or null: the whole text as a code (`abcd-efgh`, with spaces or bidi marks), an
 * invite link (`https://app.example/i/ABCD-EFGH`, `?code=ABCDEFGH`, `&referrer=code%3D…`), or the first code-shaped
 * word written in capitals in a share message ("Use my code ABCD-EFGH …"). Returns the normalised code. A JS addition: the Flutter field
 * relies on [pastedCodeText] and the server's check.
 */
export function extractInviteCode(text: string | null | undefined): string | null {
  if (text == null) return null;
  const whole = normaliseCode(text);
  if (isWellFormedCode(whole)) return whole;
  const tryCode = (s: string | null | undefined): string | null => {
    if (!s) return null;
    let v = s;
    try {
      v = decodeURIComponent(s);
    } catch {
      // Keep as is.
    }
    const c = normaliseCode(v.replace(/^code=/i, ''));
    return isWellFormedCode(c) ? c : null;
  };
  for (const m of text.matchAll(/https?:\/\/\S+/gi)) {
    try {
      const u = new URL(m[0].replace(/[).,;!?'"⁩]+$/, ''));
      const fromQuery = tryCode(u.searchParams.get('code')) ?? tryCode(u.searchParams.get('referrer'));
      if (fromQuery) return fromQuery;
      const segs = u.pathname.split('/').filter(Boolean);
      for (let i = segs.length - 1; i >= 0; i--) {
        const c = tryCode(segs[i]);
        if (c) return c;
      }
    } catch {
      // Not a URL after all.
    }
  }
  const words = text.replace(/[⁦-⁩​-‏]/g, '').split(/[^\p{L}\p{N}\-‐-―−－]+/u);
  for (const w of words) {
    // Only words written in capitals: "chapters" is code-shaped too, but nobody writes a code that way in a message.
    if (w !== w.toUpperCase()) continue;
    const c = normaliseCode(w);
    if (isWellFormedCode(c)) return c;
  }
  return null;
}
