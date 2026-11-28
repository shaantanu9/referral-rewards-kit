// A server component page that renders the client demo: the referral components are client components ("use client"
// in @myind/referral-react), so they work from the App Router as is.
import { Demo } from './demo';

export default function Page() {
  return <Demo />;
}
