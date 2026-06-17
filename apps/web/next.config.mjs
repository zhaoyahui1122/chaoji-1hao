/** @type {import('next').NextConfig} */
const defaultDistDir = process.env.NODE_ENV === 'development' ? '.next-dev' : '.next'

const nextConfig = {
  distDir: process.env.NEXT_DIST_DIR || defaultDistDir,
  output: 'export',
  images: { unoptimized: true },
  trailingSlash: true,
  turbopack: {
    root: import.meta.dirname,
  },
}

export default nextConfig
