const jodFormatter = new Intl.NumberFormat('ar-JO', {
  minimumFractionDigits: 3,
  maximumFractionDigits: 3,
});

export function formatJod(minorUnits: number): string {
  const safeMinorUnits = Number.isFinite(minorUnits)
    ? Math.max(0, Math.round(minorUnits))
    : 0;
  return `${jodFormatter.format(safeMinorUnits / 1000)} د.أ`;
}
