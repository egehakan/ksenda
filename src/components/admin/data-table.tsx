"use client";

import { useState } from "react";
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";

interface DataTableProps<TData> {
  data: TData[];
  columns: ColumnDef<TData, unknown>[];
  searchPlaceholder?: string;
  /** If set, a search box filters this column (case-insensitive contains). */
  searchColumnId?: string;
  pageSize?: number;
  onRowClick?: (row: TData) => void;
  emptyMessage?: string;
}

export function DataTable<TData>({
  data,
  columns,
  searchPlaceholder = "Search…",
  searchColumnId,
  pageSize = 25,
  onRowClick,
  emptyMessage = "No rows.",
}: DataTableProps<TData>) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [globalFilter, setGlobalFilter] = useState("");

  const table = useReactTable({
    data,
    columns,
    state: { sorting, globalFilter },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize } },
    globalFilterFn: (row, _columnId, value) => {
      if (!searchColumnId || !value) return true;
      const v = row.getValue(searchColumnId);
      return String(v ?? "")
        .toLowerCase()
        .includes(String(value).toLowerCase());
    },
  });

  const totalRows = table.getFilteredRowModel().rows.length;
  const pageIndex = table.getState().pagination.pageIndex;
  const pageCount = table.getPageCount();

  return (
    <div className="rounded-lg border border-[var(--color-line-soft)] bg-[var(--color-panel)] overflow-hidden">
      {searchColumnId && (
        <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--color-line-soft)]">
          <Search className="h-3.5 w-3.5 text-[var(--color-fg-subtle)]" />
          <Input
            value={globalFilter}
            onChange={(e) => setGlobalFilter(e.target.value)}
            placeholder={searchPlaceholder}
            className="h-8 border-none bg-transparent shadow-none focus-visible:ring-0 focus-visible:border-transparent px-0 text-[13px]"
          />
          <span className="ml-auto font-mono text-[11px] text-[var(--color-fg-subtle)]">
            {totalRows} {totalRows === 1 ? "row" : "rows"}
          </span>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-[12.5px]">
          <thead>
            {table.getHeaderGroups().map((hg) => (
              <tr
                key={hg.id}
                className="border-b border-[var(--color-line-soft)] bg-[var(--color-sidebar)]"
              >
                {hg.headers.map((header) => {
                  const sortDir = header.column.getIsSorted();
                  const canSort = header.column.getCanSort();
                  return (
                    <th
                      key={header.id}
                      className={cn(
                        "text-left px-4 py-2 font-mono uppercase tracking-[0.10em] text-[10.5px] text-[var(--color-fg-muted)] font-medium",
                        canSort && "cursor-pointer select-none"
                      )}
                      onClick={
                        canSort
                          ? header.column.getToggleSortingHandler()
                          : undefined
                      }
                    >
                      <span className="inline-flex items-center gap-1">
                        {flexRender(
                          header.column.columnDef.header,
                          header.getContext()
                        )}
                        {canSort && (
                          <SortIcon sortDir={sortDir as false | "asc" | "desc"} />
                        )}
                      </span>
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length}
                  className="px-4 py-10 text-center text-[var(--color-fg-muted)]"
                >
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              table.getRowModel().rows.map((row) => (
                <tr
                  key={row.id}
                  className={cn(
                    "border-b border-[var(--color-line-soft)] transition-colors",
                    onRowClick &&
                      "cursor-pointer hover:bg-[var(--color-raised)]/60"
                  )}
                  onClick={() => onRowClick?.(row.original)}
                >
                  {row.getVisibleCells().map((cell) => (
                    <td
                      key={cell.id}
                      className="px-4 py-2.5 align-middle text-[var(--color-fg)]"
                    >
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext()
                      )}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {pageCount > 1 && (
        <div className="flex items-center justify-between px-4 py-2.5 border-t border-[var(--color-line-soft)] text-[12px] text-[var(--color-fg-muted)]">
          <span>
            Page {pageIndex + 1} of {pageCount}
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}
              className="grid h-7 w-7 place-items-center rounded-md hover:bg-[var(--color-raised)] disabled:opacity-40 disabled:pointer-events-none"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage()}
              className="grid h-7 w-7 place-items-center rounded-md hover:bg-[var(--color-raised)] disabled:opacity-40 disabled:pointer-events-none"
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function SortIcon({ sortDir }: { sortDir: false | "asc" | "desc" }) {
  if (sortDir === "asc") {
    return <ArrowUp className="h-3 w-3 text-[var(--color-accent)]" />;
  }
  if (sortDir === "desc") {
    return <ArrowDown className="h-3 w-3 text-[var(--color-accent)]" />;
  }
  return <ArrowUpDown className="h-3 w-3 opacity-50" />;
}
