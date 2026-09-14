// Yatzy scorecard fixtures built from the page's own scoreCategories.

// Read the rows from the loaded page instead of restating them here: a copied
// id list already drifted once (threeOfAKind vs threeOfKind, 7 lower rows vs 9)
// and nothing noticed, because the code under test only sums values.
function pageCard(run) {
  return JSON.parse(run('JSON.stringify(scoreCategories)'));
}

function cell(card, section, id) {
  const row = card[section].find((r) => r.id === id);
  if (!row) throw new Error(`yatzy.html scoreCategories.${section} has no '${id}' row`);
  return row;
}

// A complete scorecard (every page row, every cell 0) whose upper section totals
// `upper` and lower section `lower`. The whole upper total sits on `ones` and
// the lower on `chance` — values real dice cannot produce, but the totalling
// code (calculateUpperTotal, calculateGrandTotal, endGame) only sums, so the
// placement is free. `run` is the loadPage runner of a booted yatzy.html.
export function scorecardTotalling(run, upper, lower) {
  const card = pageCard(run);
  for (const row of [...card.upper, ...card.lower]) row.value = 0;
  cell(card, 'upper', 'ones').value = upper;
  cell(card, 'lower', 'chance').value = lower;
  return card;
}
