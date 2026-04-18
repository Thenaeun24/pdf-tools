export default function Footer() {
  return (
    <footer className="mt-auto border-t border-white/70 bg-white/60 py-8 backdrop-blur-xl">
      <div className="mx-auto flex max-w-6xl flex-col items-center gap-2 px-4 text-center">
        <div className="inline-flex items-center gap-2 rounded-full border border-emerald-200/70 bg-emerald-50/80 px-3.5 py-1.5 text-xs font-semibold text-emerald-700 shadow-sm shadow-emerald-900/5">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.7)]" />
          End-to-End 브라우저 처리
        </div>
        <p className="text-sm text-slate-600">
          🔒 모든 파일은 브라우저에서만 처리됩니다 · 서버로 전송되지 않습니다
        </p>
      </div>
    </footer>
  );
}
