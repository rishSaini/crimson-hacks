type Props = {
  loading: boolean;
  onClick: () => void;
  className?: string;
};

/**
 * The only filled action button on screen. Callers render it if and only if the
 * current route's `flagged_stretch_count` is above 0.
 */
export function RerouteButton({ loading, onClick, className = "" }: Props) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={loading}
      className={`pointer-events-auto rounded-md bg-red-700 px-5 py-2 text-sm font-semibold text-white shadow-lg transition hover:bg-red-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-700 disabled:cursor-wait disabled:opacity-70 ${className}`}
    >
      {loading ? "Finding a line…" : "Reroute"}
    </button>
  );
}
