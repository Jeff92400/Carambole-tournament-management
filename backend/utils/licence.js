/**
 * Licence number utilities.
 *
 * FFB licence numbers are stored in various places (CSV imports, user input,
 * old records) with inconsistent whitespace and case. The canonical internal
 * representation is: no whitespace, original case unless explicitly uppercased.
 *
 * Before this module, the pattern `(licence || '').replace(/\s+/g, '')` was
 * reimplemented 40+ times across the codebase, with subtle variations
 * (`/\s/g` vs `/\s+/g`, with or without `.toUpperCase()`, with or without
 * `.trim()`, etc.). That drift caused occasional comparison bugs where a
 * normalized licence on one side did not equal the "same" licence on the other.
 *
 * Always use this helper going forward.
 */

/**
 * Normalize a licence number: remove ALL whitespace characters.
 * @param {*} licence - Input value, typically a string but handles null/undefined.
 * @param {object} [opts]
 * @param {boolean} [opts.upper=false] - If true, also uppercase the result.
 * @returns {string} Normalized licence (empty string if input was falsy).
 */
function normalizeLicence(licence, opts) {
  if (licence == null) return '';
  const clean = String(licence).replace(/\s+/g, '');
  return (opts && opts.upper) ? clean.toUpperCase() : clean;
}

/**
 * Compare two licence numbers after normalization. Case-insensitive by default
 * because FFB licence uppercase suffix letters are sometimes stored lowercase
 * in legacy data.
 * @param {*} a
 * @param {*} b
 * @returns {boolean} true if the two values refer to the same licence.
 */
function licencesEqual(a, b) {
  return normalizeLicence(a, { upper: true }) === normalizeLicence(b, { upper: true });
}

module.exports = {
  normalizeLicence,
  licencesEqual
};
