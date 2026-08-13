/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Benchmark hygiene: a build-id banner or dev overlay would distort the
  // TTFB/FCP comparison, so keep the surface minimal.
  poweredByHeader: false,
};

export default nextConfig;
