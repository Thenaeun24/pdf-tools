'use client';

import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { FileItem } from '@/types';
import { formatFileSize } from '@/utils/fileUtils';

interface SortableFileListProps {
  items: FileItem[];
  onReorder: (items: FileItem[]) => void;
  onRemove: (id: string) => void;
}

function SortableRow({
  item,
  onRemove,
}: {
  item: FileItem;
  onRemove: (id: string) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={[
        'panel-soft flex items-center gap-3 px-3 py-2.5 transition-all',
        isDragging
          ? 'border-violet-400 shadow-xl shadow-violet-500/20'
          : 'hover:border-indigo-300 hover:shadow-md hover:shadow-indigo-500/10',
      ].join(' ')}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        aria-label="드래그로 순서 변경"
        className="flex h-8 w-6 flex-none cursor-grab items-center justify-center text-slate-400 transition-colors hover:text-indigo-600 active:cursor-grabbing"
      >
        ☰
      </button>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-slate-800">
          {item.name}
        </p>
        <p className="text-xs font-medium text-slate-500">
          {formatFileSize(item.size)}
        </p>
      </div>
      <button
        type="button"
        onClick={() => onRemove(item.id)}
        aria-label={`${item.name} 삭제`}
        className="flex h-8 w-8 flex-none items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-rose-50 hover:text-rose-600"
      >
        ✕
      </button>
    </li>
  );
}

export default function SortableFileList({
  items,
  onReorder,
  onRemove,
}: SortableFileListProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = items.findIndex((i) => i.id === active.id);
    const newIndex = items.findIndex((i) => i.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    onReorder(arrayMove(items, oldIndex, newIndex));
  }

  if (items.length === 0) return null;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
    >
      <SortableContext
        items={items.map((i) => i.id)}
        strategy={verticalListSortingStrategy}
      >
        <ul className="flex flex-col gap-2">
          {items.map((item) => (
            <SortableRow key={item.id} item={item} onRemove={onRemove} />
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  );
}
