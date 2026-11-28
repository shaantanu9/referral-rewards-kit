'use client';
import { ReferralCopy, type ReferralKitLocalizations, type ReferralTerms } from '@myind/referral-core';
import qrcode from 'qrcode-generator';
import { useMemo, type ReactNode } from 'react';
import { useReferral } from '../context';
import { cx, icons, RfkButton, RfkDialog, type StyleProps } from '../ui';

export interface ReferralBoostBannerProps extends StyleProps {
  terms: ReferralTerms;
  clock?: () => Date;
  l10n?: ReferralKitLocalizations;
  render?: (ctx: { text: string; defaultContent: ReactNode }) => ReactNode;
}

/**
 * The boost banner (G8): "Double rewards until Sun, 22 Nov for every friend who adds your code by then." The real last
 * day from the server's `ends_at`, in the user's locale; never a ticking timer. Nothing when [terms] has no boost or it
 * has ended.
 */
export function ReferralBoostBanner({ terms, clock, l10n, className, style, render }: ReferralBoostBannerProps): ReactNode {
  const ctx = useReferral();
  const text = new ReferralCopy({ l10n: l10n ?? ctx.l10n, terms }).boostLine((clock ?? ctx.clock)());
  if (text == null) return null;
  const content = (
    <div className={cx('rfk-boost', className)} style={style} data-testid="referral-boost">
      <span className="rfk-boost__icon" aria-hidden="true">
        {icons.bolt}
      </span>
      <p className="rfk-text">{text}</p>
    </div>
  );
  return render ? render({ text, defaultContent: content }) : content;
}

export interface ReferralDeadlineChipProps extends StyleProps {
  text: string;
  /** The last day: the error colours. */
  lastDay?: boolean;
}

/** The real days left as a chip: the secondary colours normally, the error colours on the last day. */
export function ReferralDeadlineChip({ text, lastDay = false, className, style }: ReferralDeadlineChipProps): ReactNode {
  return (
    <span
      className={cx('rfk-chip', lastDay && 'rfk-chip--last', className)}
      style={style}
      data-testid="referral-deadline"
      data-last-day={lastDay ? 'true' : undefined}
    >
      <span className="rfk-chip__icon" aria-hidden="true">
        {icons.schedule}
      </span>
      <span>{text}</span>
    </span>
  );
}

/** The dark modules of a QR code for [value] as one SVG path (1 unit per module), and its size in modules. */
export function qrPath(value: string, level: 'L' | 'M' | 'Q' | 'H' = 'M'): { path: string; modules: number } {
  const qr = qrcode(0, level);
  qr.addData(value);
  qr.make();
  const n = qr.getModuleCount();
  let d = '';
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (qr.isDark(r, c)) d += `M${c} ${r}h1v1h-1z`;
    }
  }
  return { path: d, modules: n };
}

export interface ReferralQrCodeProps extends StyleProps {
  value: string;
  /** Pixels. Default 240. */
  size?: number;
  /** The accessible name. Default: the kit's "QR code of your invite link". */
  label?: string;
}

/**
 * A QR code as inline SVG, always black on white with a 4-module quiet zone, so it scans in dark mode too. Generated
 * locally (`qrcode-generator`), nothing is fetched.
 */
export function ReferralQrCode({ value, size = 240, label, className, style }: ReferralQrCodeProps): ReactNode {
  const { l10n } = useReferral();
  const { path, modules } = useMemo(() => qrPath(value), [value]);
  const q = 4;
  const view = modules + q * 2;
  return (
    <svg
      className={cx('rfk-qr', className)}
      style={style}
      role="img"
      aria-label={label ?? l10n.qrSemantics}
      width={size}
      height={size}
      viewBox={`${-q} ${-q} ${view} ${view}`}
      shapeRendering="crispEdges"
      data-testid="referral-qr"
      data-value={value}
    >
      <rect x={-q} y={-q} width={view} height={view} fill="#ffffff" />
      <path d={path} fill="#000000" />
    </svg>
  );
}

export interface ReferralQrSheetProps extends StyleProps {
  open: boolean;
  onClose: () => void;
  /** The https invite link (never an unlock token or a code to redeem: Apple 3.1.1). */
  link: string;
  l10n?: ReferralKitLocalizations;
}

/** "Your invite link": the QR code, a hint, the link itself and Close, in a modal dialog (Flutter's bottom sheet). */
export function ReferralQrSheet({ open, onClose, link, l10n, className, style }: ReferralQrSheetProps): ReactNode {
  const ctx = useReferral();
  const t = l10n ?? ctx.l10n;
  return (
    <RfkDialog
      open={open}
      onClose={onClose}
      title={t.qrTitle}
      className={cx('rfk-qr-sheet', className)}
      style={style}
      testId="referral-qr-sheet"
      actions={
        <RfkButton variant="text" onClick={onClose}>
          {t.close}
        </RfkButton>
      }
    >
      <div className="rfk-qr-frame">
        <ReferralQrCode value={link} label={t.qrSemantics} />
      </div>
      <p className="rfk-text rfk-center">{t.qrHint}</p>
      <p className="rfk-muted rfk-center rfk-link-text" dir="ltr">
        {link}
      </p>
    </RfkDialog>
  );
}
