'use client';
/** Inline SVG icons (Material Symbols outlines redrawn as simple paths), decorative unless given a [title]. */
import type { ReactNode } from 'react';

const paths = {
  fire: 'M12 2c1 3.5-1.5 5-1.5 7.5A2.5 2.5 0 0 0 13 12c1.6 0 2.5-1.3 2.3-3C18 11 19 13.5 19 15a7 7 0 0 1-14 0c0-3.6 2.3-6 4-7.6C10.6 6 12 4.5 12 2z',
  gift: 'M4 11h16v10H4zM3 7h18v4H3zM12 7v14M12 7c-1.5-3-5-3.5-5-1.2C7 7 9 7 12 7zm0 0c1.5-3 5-3.5 5-1.2C17 7 15 7 12 7z',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  checkCircle: 'M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18zM7.5 12.5l3 3 6-6',
  circle: 'M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18z',
  heart: 'M12 20s-7.5-4.4-7.5-10A4.3 4.3 0 0 1 12 7a4.3 4.3 0 0 1 7.5 3c0 5.6-7.5 10-7.5 10z',
  bolt: 'M13 2L5 14h6l-1 8 8-12h-6z',
  schedule: 'M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18zM12 7v5l3.5 2',
  quiz: 'M5 4h11l3 3v13H5zM9.5 9.5a2.5 2.5 0 1 1 3.3 2.4c-.5.2-.8.6-.8 1.1V14M12 17v.01',
  trophy: 'M7 4h10v4a5 5 0 0 1-10 0zM7 6H4v1a3 3 0 0 0 3 3M17 6h3v1a3 3 0 0 1-3 3M12 13v4M8 20h8M9.5 17h5',
  medal: 'M8 2h8l-2 6h-4zM12 9a6 6 0 1 1 0 12 6 6 0 0 1 0-12zM12 12l1 2.2 2.3.2-1.8 1.5.6 2.3-2.1-1.2-2.1 1.2.6-2.3-1.8-1.5 2.3-.2z',
  celebration: 'M3 21l5-14 9 9zM14 3v3M19 5l-2 2M21 10h-3M16 8l1-1',
  video: 'M3 6h12v12H3zM15 10l6-3v10l-6-3',
  personAdd: 'M9 4a4 4 0 1 1 0 8 4 4 0 0 1 0-8zM2 20c0-3.5 3-6 7-6s7 2.5 7 6M19 8v6M16 11h6',
  groupAdd: 'M8 5a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7zM1.5 20c0-3.2 2.9-5.5 6.5-5.5s6.5 2.3 6.5 5.5M19 8v6M16 11h6',
  volume: 'M4 9h4l5-4v14l-5-4H4zM16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12',
  close: 'M6 6l12 12M18 6L6 18',
  cross: 'M7 7l10 10M17 7L7 17',
} as const;

export type IconName = keyof typeof paths;

/** One icon, 24×24 by default, in `currentColor`. */
export function Icon(props: { readonly name: IconName; readonly size?: number; readonly title?: string; readonly className?: string; readonly filled?: boolean }): ReactNode {
  const size = props.size ?? 24;
  const filled = props.filled ?? false;
  return (
    <svg
      className={props.className ? `rk-icon ${props.className}` : 'rk-icon'}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={filled ? 0 : 1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={props.title ? undefined : true}
      role={props.title ? 'img' : undefined}
      focusable="false"
    >
      {props.title ? <title>{props.title}</title> : null}
      <path d={paths[props.name]} />
    </svg>
  );
}
