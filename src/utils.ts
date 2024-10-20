import type { FITSFile, NAxisRange } from "./types"

/**
 * Check if a FITS file has a specific number of axes. Useful for type guards.
 *
 * @param fits The FITS file to check.
 * @param n The number of axes to check for.
 * @returns `true` if the FITS file has `n` axes, `false` otherwise.
 */
export function hasNAxis<NAxis extends NAxisRange>(
  fits: FITSFile,
  n: NAxis,
): FITSFile<NAxis> | null {
  return fits.header.NAXIS === n ? (fits as unknown as FITSFile<NAxis>) : null
}
