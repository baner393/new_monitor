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

export function layoutDashboardCards(cards, {
  panelWidth = 700,
  padding = 20,
  columnGap = 16,
  top = 66,
  rowGap = 8,
} = {}) {
  if (!Array.isArray(cards) || cards.length === 0) return [];
  const columnWidth = (panelWidth - padding * 2 - columnGap) / 2;
  const placements = [];
  let pending = null;
  let y = top;

  const flushPending = (center = false) => {
    if (!pending) return;
    placements.push({
      ...pending,
      x: center ? (panelWidth - columnWidth) / 2 : padding,
      y,
      width: columnWidth,
    });
    y += pending.height + rowGap;
    pending = null;
  };

  for (const card of cards) {
    if (card.span === 2) {
      flushPending(true);
      placements.push({ ...card, x: padding, y, width: panelWidth - padding * 2 });
      y += card.height + rowGap;
      continue;
    }
    if (!pending) {
      pending = card;
      continue;
    }
    const rowHeight = Math.max(pending.height, card.height);
    placements.push({ ...pending, x: padding, y, width: columnWidth });
    placements.push({ ...card, x: padding + columnWidth + columnGap, y, width: columnWidth });
    y += rowHeight + rowGap;
    pending = null;
  }
  flushPending(true);
  return placements;
}
