/**
 * Pack the enabled overview cards from left to right without leaving holes
 * when individual monitor categories are hidden.
 */
export function layoutOverviewCards(cards, {
  panelWidth = 700,
  padding = 20,
  columnGap = 16,
  top = 66,
  rowGap = 8,
} = {}) {
  if (!Array.isArray(cards) || cards.length === 0) return [];

  const columnWidth = (panelWidth - padding * 2 - columnGap) / 2;
  const placements = [];
  let y = top;

  for (let index = 0; index < cards.length; index += 2) {
    const row = cards.slice(index, index + 2);
    const rowHeight = Math.max(...row.map((card) => card.height));
    const centerSingleCard = cards.length === 1 && row.length === 1;

    row.forEach((card, column) => {
      placements.push({
        ...card,
        x: centerSingleCard
          ? (panelWidth - columnWidth) / 2
          : padding + column * (columnWidth + columnGap),
        y,
        width: columnWidth,
      });
    });

    y += rowHeight + rowGap;
  }

  return placements;
}

export function calculateOverviewHeight(placements, {
  minHeight = 170,
  maxHeight = 590,
  padding = 20,
} = {}) {
  if (!Array.isArray(placements) || placements.length === 0) return minHeight;
  const contentBottom = Math.max(...placements.map(({ y, height }) => y + height)) + padding;
  return Math.max(minHeight, Math.min(maxHeight, contentBottom));
}
