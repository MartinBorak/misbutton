/**
 * Geometry of the two bands the play area is inset by — the HUD above it and
 * the footer below (see app/assets/css/main.css, which reads these as custom
 * properties that pages/index.vue injects).
 *
 * In rem rather than pixels because what the bands have to fit is text. The
 * top band's floor is whatever the leaderboard card needs, and that card is
 * sized by its own type; pinning the band to a pixel height would hold it
 * still while its contents grew with the reader's font size, until the
 * leaderboard spilled out of the band and into the arena.
 */
export const BAND_TOP_MIN_REM = 8.75
export const BAND_TOP_MAX_REM = 11
export const BAND_BOTTOM_MIN_REM = 3.5
export const BAND_BOTTOM_MAX_REM = 6

/** The root font size rem resolves against when nobody has changed it. */
export const DEFAULT_ROOT_FONT_PX = 16

/**
 * The largest root font size the pixel figures below assume. Twice the
 * browser default covers even the "very large" font settings; past that the
 * band budget in main.css caps the bands regardless, since it never lets
 * them eat into the arena's own minimum.
 */
const MAX_ROOT_FONT_PX = 2 * DEFAULT_ROOT_FONT_PX

/**
 * How far above and below the arena the cursor can legitimately be, in real
 * pixels.
 *
 * The server needs this: a round records everything in arena coordinates,
 * but the player's cursor roams the whole window, so a cursor over the HUD
 * reports a negative y and one over the footer reports a y past the arena's
 * height. The submission's out-of-bounds check has to allow exactly that
 * much overhang — see server/api/round/submit.post.ts. Since the server has
 * no idea what root font size the player is using, it assumes the largest
 * plausible one; the check is a coarse guard against garbage rather than a
 * tight bound, and the deterministic replay is what actually scores a round.
 *
 * max() over each band's floor and ceiling rather than just the ceiling, so
 * the figure stays right even if a floor is ever raised past its ceiling.
 */
export const MAX_OVERHANG_ABOVE_PX = Math.max(BAND_TOP_MIN_REM, BAND_TOP_MAX_REM) * MAX_ROOT_FONT_PX
export const MAX_OVERHANG_BELOW_PX =
  Math.max(BAND_BOTTOM_MIN_REM, BAND_BOTTOM_MAX_REM) * MAX_ROOT_FONT_PX
