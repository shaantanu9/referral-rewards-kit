import { fileURLToPath } from 'node:url';
import { withReferralKit } from '@myind/kit-next';

// The pnpm workspace root (js/): the packages are symlinked from there.
const root = fileURLToPath(new URL('../..', import.meta.url));

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  turbopack: { root },
  outputFileTracingRoot: root,
};

export default withReferralKit(config);
