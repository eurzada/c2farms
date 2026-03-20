/**
 * Build a canonical name for fuzzy matching.
 * Lowercase, strip (R)/(TM)/®/™, normalize whitespace, remove pack size suffixes.
 */
export function buildCanonicalName(rawName) {
  if (!rawName) return '';
  return rawName
    .toLowerCase()
    .replace(/[®™]/g, '')
    .replace(/\(r\)/gi, '')
    .replace(/\(tm\)/gi, '')
    .replace(/\s*\d+\s*(l|ml|kg|g|lb|lbs|gal|oz)\b/gi, '') // strip pack sizes
    .replace(/\s*-\s*/g, ' ')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Dice coefficient (bigram similarity) between two strings.
 * Returns 0..1 where 1 = identical.
 */
function bigrams(str) {
  const s = str.toLowerCase();
  const pairs = new Set();
  for (let i = 0; i < s.length - 1; i++) {
    pairs.add(s.slice(i, i + 2));
  }
  return pairs;
}

export function diceCoefficient(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const aGrams = bigrams(a);
  const bGrams = bigrams(b);
  if (aGrams.size === 0 || bGrams.size === 0) return 0;
  let intersection = 0;
  for (const g of aGrams) {
    if (bGrams.has(g)) intersection++;
  }
  return (2 * intersection) / (aGrams.size + bGrams.size);
}

/**
 * Find best match for inputName in productLibrary.
 * Returns { match, score } or null if below threshold.
 */
export function findBestMatch(inputName, productLibrary, threshold = 0.6) {
  const canonical = buildCanonicalName(inputName);
  if (!canonical) return null;

  let best = null;
  let bestScore = 0;

  for (const product of productLibrary) {
    const target = product.canonical_name || buildCanonicalName(product.name);
    const score = diceCoefficient(canonical, target);
    if (score > bestScore) {
      bestScore = score;
      best = product;
    }
  }

  if (bestScore >= threshold && best) {
    return { match: best, score: bestScore };
  }
  return null;
}

/**
 * Match a list of CWO products against work order product library.
 * Returns array of { cwoName, matchedProduct, score, status }.
 */
export function matchProducts(cwoProducts, workOrderProducts) {
  const results = [];
  for (const cwoName of cwoProducts) {
    const result = findBestMatch(cwoName, workOrderProducts);
    if (result) {
      results.push({
        cwoName,
        matchedProduct: result.match,
        score: result.score,
        status: result.score >= 0.9 ? 'exact' : 'fuzzy',
      });
    } else {
      results.push({
        cwoName,
        matchedProduct: null,
        score: 0,
        status: 'unmatched',
      });
    }
  }
  return results;
}
