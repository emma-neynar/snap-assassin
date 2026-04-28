import { SPEC_VERSION } from '@farcaster/snap';
import type { SnapEl } from './types.js';

export type Elements = Record<string, SnapEl>;

export interface Page {
  elements: Elements;
  root?: string;
  accent?: string;
  effects?: string[];
}

export function buildResponse(page: Page) {
  return {
    version: SPEC_VERSION,
    theme: { accent: page.accent ?? 'red' },
    ...(page.effects ? { effects: page.effects } : {}),
    ui: {
      root: page.root ?? 'page',
      elements: page.elements as Record<string, unknown>,
    },
  };
}

// ── Element helpers ────────────────────────────────────────────────────────────

export function stack(
  children: string[],
  opts?: { direction?: 'horizontal' | 'vertical'; gap?: 'none' | 'sm' | 'md' | 'lg' }
): SnapEl {
  return {
    type: 'stack',
    props: { direction: opts?.direction ?? 'vertical', gap: opts?.gap ?? 'md' },
    children,
  };
}

export function item(title: string, description?: string): SnapEl {
  return { type: 'item', props: { title, description: description ?? '' } };
}

export function text(content: string, opts?: { weight?: 'bold' | 'normal'; size?: 'md' | 'sm'; align?: 'left' | 'center' | 'right' }): SnapEl {
  return { type: 'text', props: { content, ...opts } };
}

export function badge(label: string, opts?: { color?: string; variant?: string }): SnapEl {
  return { type: 'badge', props: { label, ...opts } };
}

export function separator(): SnapEl {
  return { type: 'separator', props: { orientation: 'horizontal' } };
}

export function submitBtn(label: string, target: string, opts?: { variant?: 'primary' | 'secondary' }): SnapEl {
  return {
    type: 'button',
    props: { label, variant: opts?.variant ?? 'secondary' },
    on: { press: { action: 'submit', params: { target } } },
  };
}

export function profileBtn(label: string, fid: number): SnapEl {
  return {
    type: 'button',
    props: { label },
    on: { press: { action: 'view_profile', params: { fid } } },
  };
}

export function composeCastBtn(label: string, castText: string, embedUrl: string): SnapEl {
  return {
    type: 'button',
    props: { label, variant: 'secondary' },
    on: {
      press: {
        action: 'compose_cast',
        params: { text: castText, embeds: [embedUrl] },
      },
    },
  };
}

// ── Date formatting ────────────────────────────────────────────────────────────

export function fmtTime(ms: number): string {
  return new Date(ms).toUTCString().replace(' GMT', ' UTC');
}

export function fmtCountdown(ms: number): string {
  const diff = ms - Date.now();
  if (diff <= 0) return 'now';
  const mins = Math.ceil(diff / 60_000);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem > 0 ? `${hrs}h ${rem}m` : `${hrs}h`;
}

// ── Base URL ──────────────────────────────────────────────────────────────────

export function snapBase(request: Request): string {
  const fromEnv = process.env.SNAP_PUBLIC_BASE_URL?.trim();
  if (fromEnv) return fromEnv.replace(/\/$/, '');

  const fwdHost = request.headers.get('x-forwarded-host');
  const host = (fwdHost ?? request.headers.get('host'))?.split(',')[0].trim();
  const isLocal = host ? /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host) : true;
  const proto = request.headers.get('x-forwarded-proto')?.split(',')[0].trim().toLowerCase()
    ?? (isLocal ? 'http' : 'https');

  return host ? `${proto}://${host}` : `http://localhost:${process.env.PORT ?? '3003'}`;
}
