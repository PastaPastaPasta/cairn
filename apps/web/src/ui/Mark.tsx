// The Cairn mark (three stacked rounded stones) and the lowercase wordmark.

export function Mark({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <svg className={className ?? 'mark'} width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <path className="mark-stone mark-top" d="M12.4 4.2c2.2-.9 5.6-.8 7.4.3 1.6 1 1.5 3.3-.2 4.3-2 1.2-5.6 1.3-7.6.3-1.9-1-1.6-4 .4-4.9z" />
      <path className="mark-stone mark-mid" d="M8.6 12.3c3-1.4 10.4-1.5 13.9-.2 2.8 1.1 2.9 4.4.2 5.7-3.4 1.6-11.2 1.6-14.4 0-2.5-1.3-2.4-4.3.3-5.5z" />
      <path className="mark-stone mark-base" d="M4.9 21.6c4.1-2 17.6-2.1 22.1-.1 3.4 1.5 3.4 5.4.1 6.9-4.6 2.1-17.8 2-22.3 0-3.2-1.5-3.2-5.3.1-6.8z" />
    </svg>
  );
}

export function Wordmark() {
  return (
    <span className="brand">
      <Mark />
      <span className="wordmark">cairn</span>
    </span>
  );
}
