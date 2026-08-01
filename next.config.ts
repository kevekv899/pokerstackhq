import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Enables React's <ViewTransition>, which the root layout uses to
    // crossfade between routes. Without browser support the app still works —
    // the transition simply does not animate.
    viewTransition: true,
  },
};

export default nextConfig;
