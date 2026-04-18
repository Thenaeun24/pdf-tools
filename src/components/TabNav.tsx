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
    <nav className="border-b border-slate-200 bg-white">
      <div className="mx-auto max-w-6xl px-4">
        <div className="hide-scrollbar -mb-px flex gap-1 overflow-x-auto whitespace-nowrap">
          {tabs.map((tab) => {
            const active = tab.id === activeId;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => onChange(tab.id)}
                aria-current={active ? 'page' : undefined}
                className={[
                  'relative shrink-0 px-4 py-3 text-sm font-medium transition-colors',
                  'border-b-2',
                  active
                    ? 'border-indigo-600 text-indigo-700'
                    : 'border-transparent text-slate-600 hover:border-slate-300 hover:text-slate-900',
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
