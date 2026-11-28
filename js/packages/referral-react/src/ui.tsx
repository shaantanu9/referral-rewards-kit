'use client';
import {
  forwardRef,
  useEffect,
  useId,
  useRef,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type ReactNode,
} from 'react';

/** Joins class names, skipping empty ones. */
export function cx(...names: Array<string | false | null | undefined>): string {
  return names.filter(Boolean).join(' ');
}

/** Props every component takes for styling. */
export interface StyleProps {
  className?: string;
  style?: CSSProperties;
}

export type ButtonVariant = 'filled' | 'outlined' | 'text' | 'danger';

export interface RfkButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  icon?: ReactNode;
  testId?: string;
}

/** A button with a 48 px minimum target, styled by `styles.css`. */
export const RfkButton = forwardRef<HTMLButtonElement, RfkButtonProps>(function RfkButton(
  { variant = 'filled', icon, className, children, testId, type, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type ?? 'button'}
      className={cx('rfk-btn', `rfk-btn--${variant}`, className)}
      data-testid={testId}
      {...rest}
    >
      {icon ? (
        <span className="rfk-btn__icon" aria-hidden="true">
          {icon}
        </span>
      ) : null}
      <span>{children}</span>
    </button>
  );
});

/** A spinner; the container it sits in carries `aria-busy`. Still under `prefers-reduced-motion`. */
export function Spinner({ testId }: { testId?: string }): ReactNode {
  return (
    <div className="rfk-loading" aria-busy="true" data-testid={testId}>
      <span className="rfk-spinner" aria-hidden="true" />
    </div>
  );
}

/** A polite live region: screen readers announce the text when it changes. */
export function LiveText({
  children,
  className,
  testId,
}: {
  children: ReactNode;
  className?: string;
  testId?: string;
}): ReactNode {
  return (
    <p role="status" aria-live="polite" className={cx('rfk-status', className)} data-testid={testId}>
      {children}
    </p>
  );
}

const focusable =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

export interface RfkDialogProps extends StyleProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
  testId?: string;
}

/**
 * A modal dialog: `role="dialog"`, `aria-modal`, labelled by its title, focus moved in and kept in (Tab wraps),
 * Escape and the backdrop close it, focus goes back to where it was. Rendered in place (no portal), so the app's
 * `data-theme` and CSS variables apply.
 */
export function RfkDialog({ open, onClose, title, children, actions, className, style, testId }: RfkDialogProps): ReactNode {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return undefined;
    const before = (globalThis.document?.activeElement as HTMLElement | null) ?? null;
    const box = ref.current;
    const first = box?.querySelector<HTMLElement>(focusable);
    (first ?? box)?.focus();
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        closeRef.current();
        return;
      }
      if (e.key !== 'Tab' || !box) return;
      const items = Array.from(box.querySelectorAll<HTMLElement>(focusable));
      if (items.length === 0) return;
      const a = items[0]!,
        z = items[items.length - 1]!;
      const active = document.activeElement;
      if (e.shiftKey && active === a) {
        e.preventDefault();
        z.focus();
      } else if (!e.shiftKey && active === z) {
        e.preventDefault();
        a.focus();
      }
    };
    box?.addEventListener('keydown', onKey);
    return () => {
      box?.removeEventListener('keydown', onKey);
      before?.focus?.();
    };
  }, [open]);

  if (!open) return null;
  return (
    <div className="rfk-backdrop" onClick={() => onClose()} data-testid={testId ? `${testId}-backdrop` : undefined}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={cx('rfk-dialog', className)}
        style={style}
        data-testid={testId}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id={titleId} className="rfk-dialog__title">
          {title}
        </h2>
        {children}
        {actions ? <div className="rfk-actions rfk-actions--end">{actions}</div> : null}
      </div>
    </div>
  );
}

const svg = (d: string): ReactNode => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" focusable="false" aria-hidden="true">
    <path d={d} />
  </svg>
);

/** Material-style icons as inline SVG (no icon font). */
export const icons = {
  share: svg(
    'M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11A2.99 2.99 0 0 0 21 5a3 3 0 1 0-5.91.7L8.04 9.81A3 3 0 1 0 6 15c.79 0 1.5-.31 2.04-.81l7.12 4.16c-.05.21-.08.43-.08.65A2.92 2.92 0 1 0 18 16.08z',
  ),
  copy: svg(
    'M16 1H4a2 2 0 0 0-2 2v14h2V3h12V1zm3 4H8a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2zm0 16H8V7h11v14z',
  ),
  chat: svg(
    'M20 2H4a2 2 0 0 0-2 2v18l4-4h14a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2zm0 14H5.17L4 17.17V4h16v12z',
  ),
  qr: svg(
    'M3 11h8V3H3v8zm2-6h4v4H5V5zM3 21h8v-8H3v8zm2-6h4v4H5v-4zM13 3v8h8V3h-8zm6 6h-4V5h4v4zm-6 4h2v2h-2zm2 2h2v2h-2zm-2 2h2v2h-2zm4 0h2v2h-2zm2-2h2v2h-2zm0-4h2v2h-2zm-2 2h2v2h-2zm2 4h2v2h-2z',
  ),
  schedule: svg(
    'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 18a8 8 0 1 1 0-16 8 8 0 0 1 0 16zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67V7z',
  ),
  bolt: svg('M11 21h-1l1-7H7.5c-.88 0-.33-.75-.31-.78C8.48 10.94 10.42 7.54 13 3h1l-1 7h3.51c.4 0 .62.19.4.66C12.97 17.55 11 21 11 21z'),
  gift: svg(
    'M20 6h-2.18c.11-.31.18-.65.18-1a3 3 0 0 0-5.5-1.65l-.5.67-.5-.68A3 3 0 0 0 6 5c0 .35.07.69.18 1H4a2 2 0 0 0-1.99 2L2 19a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2zm-5-2a1 1 0 1 1 0 2 1 1 0 0 1 0-2zM9 4a1 1 0 1 1 0 2 1 1 0 0 1 0-2zm11 15H4v-2h16v2zm0-5H4V8h5.08L7 10.83 8.62 12 12 7.4l3.38 4.6L17 10.83 14.92 8H20v6z',
  ),
  heart: svg(
    'M16.5 3c-1.74 0-3.41.81-4.5 2.09C10.91 3.81 9.24 3 7.5 3 4.42 3 2 5.42 2 8.5c0 3.78 3.4 6.86 8.55 11.54L12 21.35l1.45-1.32C18.6 15.36 22 12.28 22 8.5 22 5.42 19.58 3 16.5 3zm-4.4 15.55-.1.1-.1-.1C7.14 14.24 4 11.39 4 8.5 4 6.5 5.5 5 7.5 5c1.54 0 3.04.99 3.57 2.36h1.87C13.46 5.99 14.96 5 16.5 5c2 0 3.5 1.5 3.5 3.5 0 2.89-3.14 5.74-7.9 10.05z',
  ),
  paste: svg(
    'M19 2h-4.18A3 3 0 0 0 12 0a3 3 0 0 0-2.82 2H5a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2zm-7 0a1 1 0 1 1 0 2 1 1 0 0 1 0-2zm7 18H5V4h2v3h10V4h2v16z',
  ),
} as const;
