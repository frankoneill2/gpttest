import React from 'react';

type Status = 'open' | 'in progress' | 'complete';
type Priority = 'all' | 'low' | 'medium' | 'high';
type Sort = 'none' | 'pri-asc' | 'pri-desc';

export interface TaskToolbarProps {
  selectedStatuses: Set<Status>;
  onToggleStatus: (status: Status) => void;

  priority: Priority;
  onPriorityChange: (p: Priority) => void;

  sort: Sort;
  onSortChange: (s: Sort) => void;

  onClear: () => void;

  search?: string;
  onSearchChange?: (q: string) => void;
}

const statusDefs: { key: Status; label: string }[] = [
  { key: 'open', label: 'Open' },
  { key: 'in progress', label: 'In progress' },
  { key: 'complete', label: 'Complete' },
];

export const TaskToolbar: React.FC<TaskToolbarProps> = ({
  selectedStatuses,
  onToggleStatus,
  priority,
  onPriorityChange,
  sort,
  onSortChange,
  onClear,
  search,
  onSearchChange,
}) => {
  return (
    <div
      className="w-full border border-gray-200 rounded-xl bg-white p-2 sm:p-3 flex flex-wrap sm:flex-nowrap gap-2 items-center"
      role="region"
      aria-label="Task filters"
    >
      {/* Status segmented multi-select */}
      <div className="flex items-stretch rounded-xl overflow-hidden border border-gray-200" role="group" aria-label="Filter by status">
        {statusDefs.map((s, idx) => {
          const pressed = selectedStatuses.has(s.key);
          return (
            <button
              key={s.key}
              type="button"
              aria-pressed={pressed}
              onClick={() => onToggleStatus(s.key)}
              className={[
                'h-12 px-3 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2',
                'transition-colors',
                pressed ? 'bg-blue-600 text-white' : 'bg-white text-gray-700',
                idx !== statusDefs.length - 1 ? 'border-r border-gray-200' : '',
              ].join(' ')}
            >
              <span className="sr-only">Status:</span>
              {s.label}
            </button>
          );
        })}
      </div>

      {/* Priority select */}
      <label className="flex items-center gap-2 text-sm text-gray-600" aria-label="Priority">
        <span className="sr-only sm:not-sr-only">Priority</span>
        <select
          value={priority}
          onChange={(e) => onPriorityChange(e.target.value as Priority)}
          className="h-12 px-3 rounded-xl border border-gray-200 bg-white text-gray-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
        >
          <option value="all">All</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
      </label>

      {/* Sort select */}
      <label className="flex items-center gap-2 text-sm text-gray-600" aria-label="Sort">
        <span className="sr-only sm:not-sr-only">Sort</span>
        <select
          value={sort}
          onChange={(e) => onSortChange(e.target.value as Sort)}
          className="h-12 px-3 rounded-xl border border-gray-200 bg-white text-gray-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
        >
          <option value="none">None</option>
          <option value="pri-desc">Priority high → low</option>
          <option value="pri-asc">Priority low → high</option>
        </select>
      </label>

      {/* Right-side actions */}
      <div className="ml-auto flex items-center gap-2">
        {onSearchChange && (
          <label className="flex items-center gap-2 text-sm text-gray-600" aria-label="Search tasks">
            <span className="sr-only">Search</span>
            <input
              type="search"
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Search…"
              className="h-12 px-3 rounded-xl border border-gray-200 bg-white text-gray-800 placeholder-gray-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            />
          </label>
        )}
        <button
          type="button"
          onClick={onClear}
          className="h-12 px-3 rounded-xl border border-gray-200 text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
        >
          Clear
        </button>
      </div>
    </div>
  );
};

export default TaskToolbar;

