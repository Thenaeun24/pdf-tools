import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'PDF 편집 도구',
  description: '브라우저에서 안전하게 PDF 편집',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" className="h-full antialiased">
      <head>
        <meta
          httpEquiv="Content-Security-Policy"
          content="default-src 'self'; script-src 'self' 'unsafe-eval' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; worker-src 'self' blob:; connect-src 'self';"
        />
      </head>
      <body className="relative flex min-h-full flex-col text-slate-900">
        {/* 떠다니는 컬러 블롭 배경 — 전체 사이트 공통 */}
        <div
          aria-hidden
          className="pointer-events-none fixed inset-0 -z-10 overflow-hidden"
        >
          <div className="animate-float absolute -left-32 top-16 h-80 w-80 rounded-full bg-gradient-to-br from-indigo-400/40 via-violet-400/30 to-transparent blur-3xl" />
          <div
            className="animate-float absolute right-[-8rem] top-48 h-96 w-96 rounded-full bg-gradient-to-br from-fuchsia-400/30 via-pink-400/20 to-transparent blur-3xl"
            style={{ animationDelay: '-6s' }}
          />
          <div
            className="animate-float absolute bottom-10 left-1/3 h-80 w-80 rounded-full bg-gradient-to-br from-sky-400/30 via-cyan-300/20 to-transparent blur-3xl"
            style={{ animationDelay: '-3s' }}
          />
        </div>
        {children}
      </body>
    </html>
  );
}
