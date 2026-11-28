// The same invite page built as a React page with the app's own layout: inviteMetadata for the <head> and
// invitePageModel for the content. Use this or the route handler at /i/[code], not both, in a real app.
import { inviteMetadata, invitePageModel, type PreviewSegment } from '@myind/kit-next';
import { MyindAttribution } from '@myind/kit-next/attribution';
import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { inviteConfig } from '../../config';

type Props = { params: Promise<{ code: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { code } = await params;
  return inviteMetadata({ config: inviteConfig, code, acceptLanguage: (await headers()).get('accept-language') });
}

function Line({ segs }: { segs: readonly PreviewSegment[] }) {
  return (
    <>
      {segs.map((s, i) => (s.name ? <bdi key={i}>{s.text}</bdi> : <span key={i}>{s.text}</span>))}
    </>
  );
}

export default async function JoinPage({ params }: Props) {
  const { code } = await params;
  const m = invitePageModel({ config: inviteConfig, code, acceptLanguage: (await headers()).get('accept-language') });
  return (
    <main className="join" lang={m.lang}>
      <p className="demo-tag">Demo — fake server</p>
      <h1>
        <Line segs={m.headline} />
      </h1>
      <p>
        <Line segs={m.lead} />
      </p>
      {m.codeDisplay ? (
        <p className="join-code" dir="ltr" aria-label={m.codeSpoken ?? undefined}>
          {m.codeDisplay}
        </p>
      ) : null}
      <a className="store" href={m.appStoreUrl}>
        {m.appStore}
      </a>
      <p className="note">{m.appStoreNote}</p>
      <a className="store" href={m.playUrl}>
        {m.googlePlay}
      </a>
      <p className="note">{m.playNote}</p>
      <p>
        <a href={m.termsUrl}>{m.terms}</a>
      </p>
      <MyindAttribution source="next-demo" />
    </main>
  );
}
