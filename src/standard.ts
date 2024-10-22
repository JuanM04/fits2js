export const BLOCK_SIZE = 2880

export const KEYWORD_RECORD_SIZE = 80

export type FITSBITPIX = 8 | 16 | 32 | 64 | -32 | -64

export type FITSHeaderValue = string | number | [real: number, imaginary: number] | boolean | undefined

// Keyword records by types

export type FITSHeaderInteger =
  | "BITPIX"
  | "BLANK"
  | "EXTLEVEL"
  | "EXTVER"
  | "GCOUNT"
  | `NAXIS${"" | number}`
  | "PCOUNT"
  | `TBCOL${number}`
  | "TFIELDS"
  | "THEAP"
const fitsHeaderIntegerRegExp = /^BITPIX|BLANK|EXTLEVEL|EXTVER|GCOUNT|NAXIS\d{0,3}|PCOUNT|TBCOL\d{1,3}|TFIELDS|THEAP$/g
export function isFITSHeaderInteger(keyword: string): keyword is FITSHeaderInteger {
  return fitsHeaderIntegerRegExp.test(keyword)
}

export type FITSHeaderReal =
  | "BSCALE"
  | "BZERO"
  | `CDELT${number}`
  | `CROTA${number}`
  | `CRPIX${number}`
  | `CRVAL${number}`
  | "DATAMAX"
  | "DATAMIN"
  | "EPOCH"
  | "EQUINOX"
  | `PSCAL${number}`
  | `PZERO${number}`
  | `TSCAL${number}`
  | `TZERO${number}`
const fitsHeaderRealRegExp = /^BSCALE|BZERO|CDELT\d{1,3}|CROTA\d{1,3}|CRPIX\d{1,3}|CRVAL\d{1,3}|DATAMAX|DATAMIN|EPOCH|EQUINOX|PSCAL\d{1,3}|PZERO\d{1,3}|TSCAL\d{1,3}|TZERO\d{1,3}$/g
export function isFITSHeaderReal(keyword: string): keyword is FITSHeaderReal {
  return fitsHeaderRealRegExp.test(keyword)
}

export type FITSHeaderString =
  | "AUTHOR"
  | "BUNIT"
  | `CTYPE${number}`
  | `DATE${string}`
  | "EXTNAME"
  | "INSTRUME"
  | "OBJECT"
  | "OBSERVER"
  | "ORIGIN"
  | `PTYPE${number}`
  | "REFERENC"
  | `TDIM${number}`
  | `TDISP${number}`
  | "TELESCOP"
  | `TFORM${number}`
  | `TNULL${number}`
  | `TTYPE${number}`
  | `TUNIT${number}`
  | "XTENSION"
const fitsHeaderStringRegExp = /^AUTHOR|BUNIT|CTYPE\d{1,3}|DATE\S{0,4}|EXTNAME|INSTRUME|OBJECT|OBSERVER|ORIGIN|PTYPE\d{1,3}|REFERENC|TDIM\d{1,3}|TDISP\d{1,3}|TELESCOP|TFORM\d{1,3}|TTYPE\d{1,3}|TUNIT\d{1,3}|XTENSION$/g
export function isFITSHeaderString(keyword: string): keyword is FITSHeaderString {
  return fitsHeaderStringRegExp.test(keyword)
}

export type FITSHeaderLogical =
  | "BLOCKED"
  | "EXTEND"
  | "GROUPS"
  | "SIMPLE"
const fitsHeaderLogicalRegExp = /^BLOCKED|EXTEND|GROUPS|SIMPLE$/g
export function isFITSHeaderLogical(keyword: string): keyword is FITSHeaderLogical {
  return fitsHeaderLogicalRegExp.test(keyword)
}
