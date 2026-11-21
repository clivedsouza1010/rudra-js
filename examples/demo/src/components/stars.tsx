export function Stars({ rating }: { rating: number }) {
  const percent = Math.max(0, Math.min(100, (rating / 5) * 100));

  return (
    <span className="stars" role="img" aria-label={`${rating.toFixed(1)} out of 5 stars`}>
      <span className="stars__fill" style={{ width: `${percent}%` }} />
    </span>
  );
}
