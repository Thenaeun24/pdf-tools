'use client';

export interface TabItem {
  id: string;
  label: string;
  icon?: string;
}

interface TabNavProps {
  tabs: TabItem[];
  activeId: string;
  onChange: (id: string) => void;
}

export default function TabNav({ tabs, activeId, onChange }: TabNavProps) {
  return (
    <nav className="sticky top-0 z-40 border-b border-white/70 bg-white/70 backdrop-blur-xl backdrop-saturate-150">
      <div className="mx-auto max-w-6xl px-4">
        <div className="hide-scrollbar flex gap-1.5 overflow-x-auto whitespace-nowrap py-3">
          {tabs.map((tab) => {
            const active = tab.id === activeId;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => onChange(tab.id)}
                aria-current={active ? 'page' : undefined}
                className={[
                  'focus-ring relative shrink-0 rounded-full px-4 py-2 text-sm font-semibold transition-all sm:px-5',
                  active
                    ? 'text-white shadow-lg shadow-indigo-500/30'
                    : 'text-slate-600 hover:bg-white/80 hover:text-indigo-700',
                ].join(' ')}
              >
                {active ? (
                  <span
                    aria-hidden
                    className="brand-gradient animate-gradient absolute inset-0 rounded-full"
                  />
                ) : null}
                <span className="relative flex items-center gap-1.5">
                  {tab.icon ? (
                    <span
                      aria-hidden
                      className={active ? 'drop-shadow-sm' : 'opacity-90'}
                    >
                      {tab.icon}
                    </span>
                  ) : null}
                  {tab.label}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
