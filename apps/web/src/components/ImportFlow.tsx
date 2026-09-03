/**
 * The two pieces both spreadsheet importers need: a visible step rail, and a file drop
 * zone that looks like the primary action it is.
 *
 * Both import pages were three stacked full-width cards on a max-w-6xl column, two of
 * which held a single small button — most of a wide screen was empty, and there was no
 * sign a later step existed until a file happened to parse. Shared rather than copied so
 * the sale and rent importers cannot drift apart (client, 2026-09-02).
 */
import { useState } from 'react';
import { FiUpload } from 'react-icons/fi';

/** Three (or however many) steps, with the current one marked. */
export function ImportStepRail({ current, labels }: { current: number; labels: string[] }) {
  return (
    <ol className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
      {labels.map((label, i) => {
        const n = i + 1;
        const done = n < current;
        const active = n === current;
        return (
          <li key={label} className="flex items-center gap-2">
            <span
              className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${
                done
                  ? 'bg-emerald-100 text-emerald-700'
                  : active
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 text-gray-500'
              }`}
            >
              {done ? '✓' : n}
            </span>
            <span className={`text-xs ${active ? 'font-semibold text-gray-800' : 'text-gray-500'}`}>
              {label}
            </span>
            {n < labels.length && <span className="mx-1 h-px w-6 bg-gray-200" aria-hidden />}
          </li>
        );
      })}
    </ol>
  );
}

/**
 * Click-or-drop target for a spreadsheet. Owns its own drag state; the caller keeps the
 * input ref so it can reset the element between picks.
 */
export function FileDropZone({ inputRef, onFile, fileName, isLoading, accept = '.xlsx', hint }: {
  inputRef: React.RefObject<HTMLInputElement | null>;
  onFile: (file: File) => void;
  fileName?: string | null;
  isLoading?: boolean;
  accept?: string;
  /** One line under the prompt — what happens to the file, in the caller's words. */
  hint?: string;
}) {
  const [dragging, setDragging] = useState(false);

  return (
    <>
      <input
        ref={inputRef as React.RefObject<HTMLInputElement>}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          // Reset so the same file can be re-picked after a failed parse.
          e.target.value = '';
          if (file) onFile(file);
        }}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const file = e.dataTransfer.files?.[0];
          if (file) onFile(file);
        }}
        className={`flex w-full flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed px-4 py-8 transition-colors ${
          dragging
            ? 'border-blue-400 bg-blue-50'
            : 'border-gray-200 bg-gray-50/60 hover:border-blue-300 hover:bg-blue-50/40'
        }`}
      >
        <FiUpload className={`w-5 h-5 ${dragging ? 'text-blue-500' : 'text-gray-400'}`} />
        {isLoading ? (
          <span className="text-sm font-medium text-gray-700">Checking the file…</span>
        ) : fileName ? (
          <>
            <span className="text-sm font-medium text-gray-800">{fileName}</span>
            <span className="text-xs text-gray-500">Click or drop another file to replace it</span>
          </>
        ) : (
          <>
            <span className="text-sm font-medium text-gray-800">
              Drop your {accept} here, or click to choose
            </span>
            {hint && <span className="text-xs text-gray-500">{hint}</span>}
          </>
        )}
      </button>
    </>
  );
}
