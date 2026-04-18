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
    <nav className="sticky top-0 z-40 border-b border-zinc-200/90 bg-white/90 backdrop-blur-md">
      <div className="mx-auto max-w-6xl px-4">
        <div className="hide-scrollbar -mb-px flex gap-0.5 overflow-x-auto whitespace-nowrap">
          {tabs.map((tab) => {
            const active = tab.id === activeId;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => onChange(tab.id)}
                aria-current={active ? 'page' : undefined}
                className={[
                  'relative shrink-0 rounded-t-lg px-4 py-3.5 text-sm font-medium transition-colors',
                  'border-b-2',
                  active
                    ? 'border-zinc-900 text-zinc-900'
                    : 'border-transparent text-zinc-500 hover:border-zinc-200 hover:text-zinc-800',
                ].join(' ')}
              >
                {tab.icon ? <span className="mr-1.5">{tab.icon}</span> : null}
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
