import type { NextConfig } from 'next';
import path from 'node:path';

/**
 * basePath / assetPrefix 를 환경 변수로 제어한다.
 *
 * - GitHub Pages 처럼 서브경로에서 호스팅할 때:
 *     NEXT_PUBLIC_BASE_PATH=/pdf-tools  (빌드/배포 파이프라인에서 주입)
 * - Cloudflare Pages / Vercel / 루트 도메인에서 호스팅할 때:
 *     값을 비워 두면 basePath / assetPrefix 자체를 설정하지 않는다.
 *
 * Cloudflare Pages 는 루트(`/`) 에서 서빙되므로 basePath 가 고정되어 있으면
 * `_next/static/...` 경로가 `/pdf-tools/_next/...` 로 요청돼 모든 JS/CSS가
 * 404 가 되고 하얀 화면만 뜨는 문제가 생긴다.
 *
 * Cloudflare Pages UI 는 환경변수를 빈 문자열로 저장하지 못하기 때문에,
 * 아래 두 가지 방식으로 안전하게 basePath 를 비운다.
 *   1) Cloudflare Pages / Vercel 빌드 환경은 각각 CF_PAGES=1, VERCEL=1 을
 *      자동 주입한다. 이 값이 감지되면 NEXT_PUBLIC_BASE_PATH 값과 무관하게
 *      basePath 를 비워 루트 서빙에 맞춘다.
 *   2) `/`, `-`, `none`, `empty` 같은 센티널 값도 "빈 값" 으로 해석한다.
 */
const isRootHostedDeploy =
  process.env.CF_PAGES === '1' ||
  process.env.CF_PAGES === 'true' ||
  process.env.VERCEL === '1' ||
  process.env.VERCEL === 'true';

const EMPTY_SENTINELS = new Set(['', '/', '-', 'none', 'empty']);
const rawBasePath = (process.env.NEXT_PUBLIC_BASE_PATH ?? '').trim();
const normalizedBasePath =
  isRootHostedDeploy || EMPTY_SENTINELS.has(rawBasePath.toLowerCase())
    ? ''
    : rawBasePath.replace(/\/$/, '');

const nextConfig: NextConfig = {
  output: 'export',
  ...(normalizedBasePath
    ? {
        basePath: normalizedBasePath,
        assetPrefix: `${normalizedBasePath}/`,
      }
    : {}),
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
