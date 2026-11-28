'use client';
import {
  lightRewardsTheme,
  recapKey,
  RewardSpec,
  type DayInput,
  type Recap,
  type RewardsTexts,
} from '@myind/rewards-core';
import { useEffect, useImperativeHandle, useRef, useState, type CSSProperties, type ReactNode, type Ref } from 'react';
import { RewardsListener } from './base';
import { useRewardsController, useRewardsTexts } from './context';
import { Icon } from './icons';
import { Card, cx, type BaseProps } from './internal';

// ---- RecapCard ----

export interface RecapCardProps extends BaseProps {
  /** First and last local day (a Date's local day, or `YYYY-MM-DD`). */
  readonly from: DayInput;
  readonly to: DayInput;
  readonly title?: string | null;
  readonly render?: (recap: Recap) => ReactNode;
}

/**
 * A recap between two local days ("your week", "your year"): days active, best streak, what was earned, what was
 * done, badges. Loads `rewards_recap` itself on mount.
 */
export function RecapCard(props: RecapCardProps): ReactNode {
  const texts = useRewardsTexts(props.texts);
  const c = useRewardsController(props.controller);
  const key = recapKey(props.from, props.to);
  const range = useRef({ from: props.from, to: props.to });
  range.current = { from: props.from, to: props.to };
  useEffect(() => {
    const { from, to } = range.current;
    if (c.recap(from, to) == null) void c.loadRecap(from, to);
  }, [c, key]);
  return (
    <RewardsListener
      controller={c}
      render={() => {
        const r = c.recap(props.from, props.to);
        if (r == null) return null;
        if (props.render) return props.render(r);
        const x = texts.programs;
        const title = props.title ?? x.recapTitle;
        return (
          <Card name="rk-recap" className={props.className} style={props.style} label={title}>
            <h3 className="rk-title">{title}</h3>
            <p className="rk-number">{x.recapDaysActive(r.daysActive)}</p>
            <p>{x.recapBestStreak(r.bestStreak)}</p>
            {r.grants.length > 0 ? (
              <>
                <p className="rk-muted">{x.recapEarned}</p>
                <ul className="rk-list">
                  {r.grants.map((g, i) => (
                    <li key={i}>{texts.reward(g.spec)}</li>
                  ))}
                </ul>
              </>
            ) : null}
            {r.events.length > 0 ? (
              <ul className="rk-list">
                {r.events.map((e, i) => (
                  <li key={i} className="rk-muted">
                    {x.recapEvent(e.type, e.count)}
                  </li>
                ))}
              </ul>
            ) : null}
            {r.badges.length > 0 ? (
              <ul className="rk-chips">
                {r.badges.map((b, i) => (
                  <li key={i} className="rk-chip">
                    <Icon name="medal" size={18} className="rk-accent" />
                    {texts.reward(new RewardSpec({ kind: 'badge', amount: 1, params: { badge: b.badge } }))}
                  </li>
                ))}
              </ul>
            ) : null}
          </Card>
        );
      }}
    />
  );
}

// ---- RecapShareCard ----

/** The first and last day of calendar [year] (UTC dates), for `controller.loadRecap(...)` and a "Your 2026" card. */
export function recapYear(year: number): [Date, Date] {
  return [new Date(Date.UTC(year, 0, 1)), new Date(Date.UTC(year, 11, 31))];
}

/** "Your 2026" when [recap] covers one whole calendar year, else "Your recap". */
export function recapTitle(recap: Recap, texts: RewardsTexts): string {
  const f = recap.from,
    t = recap.to;
  const x = texts.recapCard;
  if (
    f != null &&
    t != null &&
    f.getUTCFullYear() === t.getUTCFullYear() &&
    f.getUTCMonth() === 0 &&
    f.getUTCDate() === 1 &&
    t.getUTCMonth() === 11 &&
    t.getUTCDate() === 31
  ) {
    return x.yearTitle(f.getUTCFullYear());
  }
  return x.rangeTitle;
}

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export interface RecapSvgOptions {
  readonly texts: RewardsTexts;
  readonly title?: string | null;
  readonly subtitle?: string | null;
  /** Image size in px. Default 1080 × 1350 (4:5). */
  readonly width?: number;
  readonly height?: number;
  readonly maxEvents?: number;
  /** Card colour and text colour. Default the light theme's accent and on-accent. */
  readonly background?: string;
  readonly foreground?: string;
  readonly fontFamily?: string;
}

/**
 * The share card as a self-contained SVG (no external fonts or images), the same content as the on-screen card: the
 * title, three big numbers, the top actions and what was earned. Rasterise it with [recapSvgToPng].
 */
export function recapCardSvg(recap: Recap, opts: RecapSvgOptions): string {
  const w = opts.width ?? 1080;
  const h = opts.height ?? Math.round((w * 5) / 4);
  const bg = opts.background ?? lightRewardsTheme.accent;
  const fg = opts.foreground ?? lightRewardsTheme.onAccent;
  const font = opts.fontFamily ?? 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
  const x = opts.texts.recapCard;
  const pad = Math.round(w * 0.075);
  const unit = w / 1080;
  const lines: string[] = [];
  const text = (y: number, size: number, value: string, weight = 400, opacity = 1, xPos = pad): void => {
    lines.push(
      `<text x="${xPos}" y="${Math.round(y)}" font-size="${Math.round(size * unit)}" font-weight="${weight}" fill="${esc(fg)}" fill-opacity="${opacity}">${esc(value)}</text>`,
    );
  };
  let y = pad + 80 * unit;
  text(y, 84, opts.title ?? recapTitle(recap, opts.texts), 800);
  if (opts.subtitle) {
    y += 64 * unit;
    text(y, 40, opts.subtitle, 400, 0.8);
  }
  y += 220 * unit;
  const stats: Array<[number, string]> = [
    [recap.daysActive, x.daysActive(recap.daysActive)],
    [recap.bestStreak, x.bestStreak(recap.bestStreak)],
    [recap.badges.length, x.badges(recap.badges.length)],
  ];
  const col = (w - pad * 2) / 3;
  stats.forEach(([n, label], i) => {
    text(y, 150, String(n), 700, 1, pad + col * i);
    text(y + 64 * unit, 36, label, 400, 0.8, pad + col * i);
  });
  y += 200 * unit;
  const events = recap.events.slice(0, opts.maxEvents ?? 3);
  if (events.length > 0) {
    text(y, 36, x.mostDone, 400, 0.8);
    for (const e of events) {
      y += 60 * unit;
      text(y, 44, opts.texts.programs.recapEvent(e.type, e.count));
    }
    y += 90 * unit;
  }
  const grants = recap.grants.slice(0, 3);
  if (grants.length > 0) {
    text(y, 36, x.earned, 400, 0.8);
    y += 60 * unit;
    text(y, 44, grants.map((g) => opts.texts.reward(new RewardSpec({ kind: g.kind, amount: g.amount }))).join(' · '));
  }
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" font-family="${esc(font)}">` +
    `<rect width="${w}" height="${h}" rx="${Math.round(48 * unit)}" fill="${esc(bg)}"/>` +
    lines.join('') +
    `</svg>`
  );
}

/** Rasterises [svg] to a PNG Blob in the browser (an `Image` drawn on a canvas). Rejects outside a browser. */
export function recapSvgToPng(svg: string, width: number, height: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    if (typeof document === 'undefined' || typeof Image === 'undefined') {
      reject(new Error('recapSvgToPng needs a browser'));
      return;
    }
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return reject(new Error('no 2d canvas'));
      ctx.drawImage(img, 0, 0, width, height);
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png');
    };
    img.onerror = () => reject(new Error('the SVG did not load'));
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  });
}

/** What a [RecapShareCard]'s `shareRef` gives: the image, and the two user-tap actions. */
export interface RecapShareHandle {
  toSvg(): string;
  toPngBlob(): Promise<Blob>;
  /** Saves the PNG as a file. */
  download(): Promise<void>;
  /** Opens the system share sheet with the PNG (Web Share API with files); falls back to [download]. */
  share(): Promise<'shared' | 'downloaded' | 'cancelled'>;
}

export interface RecapShareCardProps {
  readonly recap: Recap;
  readonly texts?: RewardsTexts;
  /** Default "Your 2026" for a whole calendar year, else "Your recap". */
  readonly title?: string | null;
  /** A line under the title, e.g. the app's name. */
  readonly subtitle?: string | null;
  /** At the bottom of the on-screen card, e.g. the app's logo (not drawn into the image). */
  readonly footer?: ReactNode;
  /** Width / height. Default 4 / 5 (a feed post); 9 / 16 for stories; null = natural height. */
  readonly aspectRatio?: number | null;
  /** How many "most done" lines. Default 3. */
  readonly maxEvents?: number;
  /** Width of the PNG in px. Default 1080. */
  readonly imageWidth?: number;
  /** The file name for download / share. Default `recap.png`. */
  readonly fileName?: string;
  /** Show the Download / Share buttons under the card. Default true. Nothing is shared without a tap. */
  readonly showActions?: boolean;
  readonly downloadLabel?: string;
  readonly shareLabel?: string;
  /** Gets the image actions, for your own buttons. */
  readonly shareRef?: Ref<RecapShareHandle>;
  /** Replaces the default rasteriser (e.g. in tests or a worker). */
  readonly rasterize?: (svg: string, width: number, height: number) => Promise<Blob>;
  /** Your own on-screen look (the image keeps the default layout, in your colours). */
  readonly render?: (recap: Recap) => ReactNode;
  readonly className?: string;
  readonly style?: CSSProperties;
}

const cssVar = (el: Element | null, name: string): string | null => {
  if (!el || typeof getComputedStyle !== 'function') return null;
  const v = getComputedStyle(el).getPropertyValue(name).trim();
  return v === '' ? null : v;
};

/**
 * A shareable recap card ("Your 2026"): days active, best streak and badges as big numbers, what was done most and
 * what was earned (port of `RewardsRecapCard`). It renders on screen, and turns into a PNG (an SVG drawn on a
 * canvas, in the card's own colours) only when the user taps Download or Share, or when the app calls `shareRef`.
 */
export function RecapShareCard(props: RecapShareCardProps): ReactNode {
  const texts = useRewardsTexts(props.texts);
  const root = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const [canShareFiles, setCanShareFiles] = useState(false);
  const recap = props.recap;
  const ratio = props.aspectRatio === undefined ? 4 / 5 : props.aspectRatio;
  const width = props.imageWidth ?? 1080;
  const height = Math.round(width / (ratio ?? 4 / 5));
  const fileName = props.fileName ?? 'recap.png';

  useEffect(() => {
    try {
      const probe = typeof File === 'function' ? new File([''], fileName, { type: 'image/png' }) : null;
      setCanShareFiles(probe != null && typeof navigator !== 'undefined' && typeof navigator.canShare === 'function' && navigator.canShare({ files: [probe] }));
    } catch {
      setCanShareFiles(false);
    }
  }, [fileName]);

  const handle: RecapShareHandle = {
    toSvg: () =>
      recapCardSvg(recap, {
        texts,
        title: props.title ?? null,
        subtitle: props.subtitle ?? null,
        width,
        height,
        maxEvents: props.maxEvents ?? 3,
        background: cssVar(root.current, '--rk-accent') ?? lightRewardsTheme.accent,
        foreground: cssVar(root.current, '--rk-on-accent') ?? lightRewardsTheme.onAccent,
      }),
    toPngBlob: () => (props.rasterize ?? recapSvgToPng)(handle.toSvg(), width, height),
    download: async () => {
      const blob = await handle.toPngBlob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    },
    share: async () => {
      const blob = await handle.toPngBlob();
      const file = new File([blob], fileName, { type: 'image/png' });
      if (typeof navigator !== 'undefined' && typeof navigator.share === 'function' && navigator.canShare?.({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: props.title ?? recapTitle(recap, texts) });
          return 'shared';
        } catch {
          return 'cancelled';
        }
      }
      await handle.download();
      return 'downloaded';
    },
  };
  useImperativeHandle(props.shareRef, () => handle);

  const run = async (f: () => Promise<unknown>): Promise<void> => {
    if (busy) return;
    setBusy(true);
    try {
      await f();
    } finally {
      setBusy(false);
    }
  };

  const x = texts.recapCard;
  const events = recap.events.slice(0, props.maxEvents ?? 3);
  const grants = recap.grants.slice(0, 3);
  const title = props.title ?? recapTitle(recap, texts);
  const card = props.render ? (
    props.render(recap)
  ) : (
    <div className="rk-share__card" style={ratio == null ? undefined : { aspectRatio: String(ratio) }}>
      <h3 className="rk-share__title">{title}</h3>
      {props.subtitle ? <p className="rk-share__soft rk-ellipsis">{props.subtitle}</p> : null}
      <div className="rk-share__stats">
        {(
          [
            [recap.daysActive, x.daysActive(recap.daysActive)],
            [recap.bestStreak, x.bestStreak(recap.bestStreak)],
            [recap.badges.length, x.badges(recap.badges.length)],
          ] as const
        ).map(([n, label], i) => (
          <div key={i} className="rk-share__stat">
            <span className="rk-share__value">{n}</span>
            <span className="rk-share__soft">{label}</span>
          </div>
        ))}
      </div>
      {events.length > 0 ? (
        <div>
          <p className="rk-share__soft">{x.mostDone}</p>
          {events.map((e, i) => (
            <p key={i} className="rk-ellipsis">
              {texts.programs.recapEvent(e.type, e.count)}
            </p>
          ))}
        </div>
      ) : null}
      {grants.length > 0 ? (
        <div>
          <p className="rk-share__soft">{x.earned}</p>
          <p>{grants.map((g) => texts.reward(new RewardSpec({ kind: g.kind, amount: g.amount }))).join(' · ')}</p>
        </div>
      ) : null}
      {props.footer ?? null}
    </div>
  );
  return (
    <div ref={root} className={cx('rk', 'rk-share', props.className)} style={props.style}>
      {card}
      {props.showActions ?? true ? (
        <div className="rk-row rk-share__actions">
          <button type="button" className="rk-button rk-button--outlined" disabled={busy} onClick={() => void run(handle.download)}>
            {props.downloadLabel ?? 'Download'}
          </button>
          {canShareFiles ? (
            <button type="button" className="rk-button" disabled={busy} onClick={() => void run(handle.share)}>
              {props.shareLabel ?? 'Share'}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** The Flutter name of [RecapShareCard]. */
export const RewardsRecapCard = RecapShareCard;
