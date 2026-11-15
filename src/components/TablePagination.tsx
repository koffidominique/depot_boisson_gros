import React, { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

export function usePagination<T>(items: T[], initialPageSize = 8) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(initialPageSize);

  const totalItems = items.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));

  useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages);
    }
  }, [page, totalPages]);

  const safePage = Math.min(page, totalPages);
  const startIndex = totalItems === 0 ? 0 : (safePage - 1) * pageSize;
  const endIndex = Math.min(totalItems, startIndex + pageSize);

  const paginatedItems = useMemo(
    () => items.slice(startIndex, endIndex),
    [items, startIndex, endIndex]
  );

  const handlePageSizeChange = (nextSize: number) => {
    setPageSize(nextSize);
    setPage(1);
  };

  return {
    page: safePage,
    setPage,
    pageSize,
    setPageSize: handlePageSizeChange,
    totalItems,
    totalPages,
    startIndex,
    endIndex,
    paginatedItems,
  };
}

interface TablePaginationProps {
  page: number;
  totalPages: number;
  pageSize: number;
  totalItems: number;
  startIndex: number;
  endIndex: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  pageSizeOptions?: number[];
  itemLabel?: string;
}

export const TablePagination: React.FC<TablePaginationProps> = ({
  page,
  totalPages,
  pageSize,
  totalItems,
  startIndex,
  endIndex,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = [5, 8, 15, 25, 50],
  itemLabel = 'lignes',
}) => {
  const pageNumbers = useMemo(() => {
    const pages: (number | 'ellipsis')[] = [];
    if (totalPages <= 7) {
      for (let i = 1; i <= totalPages; i++) pages.push(i);
      return pages;
    }
    pages.push(1);
    if (page > 3) pages.push('ellipsis');
    const start = Math.max(2, page - 1);
    const end = Math.min(totalPages - 1, page + 1);
    for (let i = start; i <= end; i++) pages.push(i);
    if (page < totalPages - 2) pages.push('ellipsis');
    pages.push(totalPages);
    return pages;
  }, [page, totalPages]);

  return (
    <div className="no-print mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-3.5 text-xs text-slate-600 dark:border-slate-800 dark:text-slate-400">
      <div className="flex flex-wrap items-center gap-3">
        <span className="tabular-nums">
          {totalItems === 0 ? (
            `0 ${itemLabel}`
          ) : (
            <>
              Affichage{' '}
              <strong className="font-mono text-slate-900 dark:text-white">
                {startIndex + 1}–{endIndex}
              </strong>{' '}
              sur{' '}
              <strong className="font-mono text-slate-900 dark:text-white">{totalItems}</strong>{' '}
              {itemLabel}
            </>
          )}
        </span>

        <label className="inline-flex items-center gap-1.5">
          <span className="text-[11px] text-slate-500">Par page :</span>
          <select
            aria-label="Nombre de lignes par page"
            value={pageSize}
            onChange={(e) => onPageSizeChange(Number(e.target.value))}
            className="min-h-[32px] rounded-lg border border-slate-200 bg-white px-2 font-mono text-xs font-semibold text-slate-800 focus:border-emerald-600 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
          >
            {pageSizeOptions.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="flex items-center gap-1">
        <button
          type="button"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
          aria-label="Page précédente"
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>

        {pageNumbers.map((num, idx) =>
          num === 'ellipsis' ? (
            <span key={`ell-${idx}`} className="px-1.5 text-slate-400">
              …
            </span>
          ) : (
            <button
              key={num}
              type="button"
              onClick={() => onPageChange(num)}
              className={`inline-flex h-8 min-w-[32px] items-center justify-center rounded-lg px-2 font-mono text-xs font-semibold tabular-nums transition-colors ${
                page === num
                  ? 'bg-emerald-700 text-white shadow-xs'
                  : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300'
              }`}
            >
              {num}
            </button>
          )
        )}

        <button
          type="button"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
          aria-label="Page suivante"
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
};
