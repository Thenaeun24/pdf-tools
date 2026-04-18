import type { NextConfig } from 'next';
import path from 'node:path';

const nextConfig: NextConfig = {
  output: 'export',
  basePath: process.env.NODE_ENV === 'production' ? '/pdf-tools' : '',
  assetPrefix: process.env.NODE_ENV === 'production' ? '/pdf-tools/' : '',
  images: { unoptimized: true },
  trailingSlash: true,

  // pdfjs-dist / pdf-lib가 선택적 의존성으로 Node `canvas`를 참조함.
  // 브라우저 번들에서는 불필요하므로 빈 모듈로 대체한다.
  turbopack: {
    resolveAlias: {
      canvas: path.resolve('./empty-module.js'),
    },
  },
  webpack: (config) => {
    config.resolve.alias.canvas = false;
    return config;
  },
};

export default nextConfig;
