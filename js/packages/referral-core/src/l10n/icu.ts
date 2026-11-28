/**
 * The small part of ICU MessageFormat the ARB files use: `{name}` placeholders, `{n, plural, =1{…} other{…}}` and
 * `{x, select, a{…} other{…}}`, nested. Plural choice follows Dart's `Intl.pluralLogic`, which the Flutter package
 * uses: an exact `=0` / `=1` / `=2` case wins for 0 / 1 / 2, then the locale's CLDR category (`zero`, `one`, `two`,
 * `few`, `many`), where `=0`, `=1` and `=2` also stand for `zero`, `one` and `two`; else `other`. Apostrophes are
 * literal (Flutter's default, no ICU escaping).
 */

type Node =
  | { t: 'text'; v: string }
  | { t: 'arg'; name: string }
  | { t: 'plural'; name: string; cases: Record<string, Node[]> }
  | { t: 'select'; name: string; cases: Record<string, Node[]> };

const cache = new Map<string, Node[]>();

function parse(src: string): Node[] {
  let i = 0;
  const nodes = (): Node[] => {
    const out: Node[] = [];
    let text = '';
    while (i < src.length) {
      const c = src[i]!;
      if (c === '}') break;
      if (c === '{') {
        if (text) out.push({ t: 'text', v: text });
        text = '';
        out.push(arg());
        continue;
      }
      text += c;
      i++;
    }
    if (text) out.push({ t: 'text', v: text });
    return out;
  };
  const arg = (): Node => {
    i++; // {
    const close = (): void => {
      if (src[i] !== '}') throw new Error(`ICU: expected } at ${i} in ${JSON.stringify(src)}`);
      i++;
    };
    let head = '';
    while (i < src.length && src[i] !== '}' && src[i] !== ',') head += src[i++];
    const name = head.trim();
    if (src[i] === '}') {
      close();
      return { t: 'arg', name };
    }
    i++; // ,
    let kind = '';
    while (i < src.length && src[i] !== ',' && src[i] !== '}') kind += src[i++];
    kind = kind.trim();
    if (src[i] === '}') {
      close();
      return { t: 'arg', name };
    }
    i++; // ,
    const cases: Record<string, Node[]> = {};
    for (;;) {
      while (i < src.length && /\s/.test(src[i]!)) i++;
      if (src[i] === '}') break;
      let key = '';
      while (i < src.length && src[i] !== '{' && !/\s/.test(src[i]!)) key += src[i++];
      while (i < src.length && /\s/.test(src[i]!)) i++;
      if (src[i] !== '{') throw new Error(`ICU: expected { after case ${key} in ${JSON.stringify(src)}`);
      i++;
      cases[key] = nodes();
      close();
    }
    close();
    if (kind === 'plural') return { t: 'plural', name, cases };
    if (kind === 'select') return { t: 'select', name, cases };
    return { t: 'arg', name };
  };
  const result = nodes();
  if (i !== src.length) throw new Error(`ICU: unexpected } at ${i} in ${JSON.stringify(src)}`);
  return result;
}

const rulesCache = new Map<string, Intl.PluralRules>();
function pluralCategory(locale: string, n: number): string {
  let r = rulesCache.get(locale);
  if (!r) {
    try {
      r = new Intl.PluralRules(locale);
    } catch {
      r = new Intl.PluralRules('en');
    }
    rulesCache.set(locale, r);
  }
  return r.select(n);
}

/** Dart `Intl.pluralLogic` over the ICU cases. */
function pluralCase(cases: Record<string, Node[]>, n: number, locale: string): Node[] {
  const slot = (name: 'zero' | 'one' | 'two' | 'few' | 'many'): Node[] | undefined => {
    const exact = name === 'zero' ? '=0' : name === 'one' ? '=1' : name === 'two' ? '=2' : undefined;
    return (exact ? cases[exact] : undefined) ?? cases[name];
  };
  if (n === 0 && slot('zero')) return slot('zero')!;
  if (n === 1 && slot('one')) return slot('one')!;
  if (n === 2 && slot('two')) return slot('two')!;
  const exactOther = cases[`=${n}`];
  if (exactOther) return exactOther;
  const cat = pluralCategory(locale, n) as 'zero' | 'one' | 'two' | 'few' | 'many' | 'other';
  if (cat !== 'other') {
    const c = slot(cat);
    if (c) return c;
  }
  return cases['other'] ?? [];
}

function render(nodes: Node[], args: Record<string, unknown>, locale: string): string {
  let s = '';
  for (const n of nodes) {
    switch (n.t) {
      case 'text':
        s += n.v;
        break;
      case 'arg':
        s += String(args[n.name] ?? '');
        break;
      case 'plural': {
        const v = Number(args[n.name] ?? 0);
        s += render(pluralCase(n.cases, v, locale), args, locale);
        break;
      }
      case 'select': {
        const v = String(args[n.name] ?? '');
        s += render(n.cases[v] ?? n.cases['other'] ?? [], args, locale);
        break;
      }
    }
  }
  return s;
}

/** Formats an ICU message with named [args] for [locale]. Parsed messages are cached. */
export function formatIcu(message: string, args: Record<string, unknown>, locale: string): string {
  let nodes = cache.get(message);
  if (!nodes) {
    nodes = parse(message);
    cache.set(message, nodes);
  }
  return render(nodes, args, locale);
}
