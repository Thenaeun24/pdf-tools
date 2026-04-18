import type { NextConfig } from 'next';
import path from 'node:path';

/**
 * basePath / assetPrefix 를 "GitHub Actions 안에서 NEXT_PUBLIC_BASE_PATH 가
 * 명시적으로 주입된 경우에만" 적용하는 화이트리스트 방식으로 관리한다.
 *
 * 배경:
 *   - 이 프로젝트는 `저장소이름/` 하위 경로로 서빙되는 GitHub Pages 와,
 *     루트 도메인으로 서빙되는 Cloudflare Pages 양쪽에 동시에 배포된다.
 *   - GitHub Pages 는 basePath=/pdf-tools 가 필요하고, 다른 곳은 빈 값이
 *     필요하다. 그런데 Cloudflare Pages UI 는 환경변수를 빈 문자열로 저장
 *     하지 못해서, 한 번 `/pdf-tools` 같은 값이 저장되면 지울 방법이 없다.
 *
 * 해결:
 *   - basePath 를 적용하는 유일한 트리거를 `GITHUB_ACTIONS=true` 로 고정.
 *   - Cloudflare Pages / Vercel / 로컬 등 GitHub Actions 밖의 모든 환경은
 *     NEXT_PUBLIC_BASE_PATH 값이 뭐든 무시하고 basePath 를 비운다.
 *   - 결과적으로 Cloudflare 환경변수창을 건드리지 않아도 루트 서빙에 맞는
 *     자산 경로(`/_next/...`)가 생성된다.
 */
const isGitHubActions = process.env.GITHUB_ACTIONS === 'true';
const rawBasePath = (process.env.NEXT_PUBLIC_BASE_PATH ?? '').trim();
const normalizedBasePath = isGitHubActions
  ? rawBasePath.replace(/\/$/, '')
  : '';

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
