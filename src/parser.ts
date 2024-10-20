import type { FITSFile, FITSHeader, FITSHeaderKeyword, NAxisRange } from "./types.js"
import * as Σ from "@nrsk/sigma"
import { BLOCK_SIZE, KEYWORD_RECORD_SIZE } from "./consts.js"

export class FITSParserError extends Error {
  public readonly code: keyof typeof FITSParserError.messages
  public readonly position: number | undefined = undefined

  constructor(code: keyof typeof FITSParserError.messages, position?: number) {
    super(FITSParserError.messages[code])
    this.name = "FITSParserError"
    this.code = code
    this.position = position
  }

  private static readonly messages = {
    INVALID_DATA: "The data of the FITS file is invalid.",
    MALFORMED_KEYWORD_RECORD: "The keyword record of a header of the FITS file is malformed or incomplete.",
    MISMATCHED_NAXIS: "The number of axes of FITS file mismatches the value provided to the function.",
    NOT_STANDARD: "The FITS file is not in the standard format.",
    REPEATED_KEYWORD: "The FITS file has repeated keywords.",
  } as const

  public toString(): string {
    let str = `${super.toString()} [${this.code}]`
    if (typeof this.position === "number") {
      str += ` (at byte ${this.position})`
    }
    return str
  }
}

// ======== Header parser ========

// Just count spaces, not all whitespaces
const spaces = (): Σ.Parser<string> => Σ.map(Σ.many1(Σ.string(" ")), spaces => spaces.join(""))

// Σ.whole doesn't work with leading zeros, this function is a workaround
const fullwhole = (): Σ.Parser<number> => Σ.map(Σ.many1(Σ.oneOf("0123456789")), n => Number.parseInt(n.join(""), 10))

// Parses a string with its quotes and escaped quotes
function fitsstring(): Σ.Parser<string> {
  return Σ.map(
    Σ.sequence(
      Σ.string("'"),
      Σ.takeUntil(
        Σ.choice(
          Σ.mapTo(Σ.string("''"), "'"), // Escaped single quote
          Σ.any(),
        ),
        Σ.string("'"),
      ),
    ),
    ([, [content]]) => {
      const str = content.join("")
      return str.slice(0, 1) + str.slice(0).trimEnd() // Trim trailing spaces except the first one
    },
  )
}

// Σ.float doesn't work with exponential notation, this function is a workaround
function fitsfloat(): Σ.Parser<number> {
  return Σ.map(
    Σ.sequence(
      Σ.optional(Σ.oneOf("+-")),
      fullwhole(),
      Σ.map(
        Σ.optional(
          Σ.takeRight(
            Σ.string("."),
            Σ.optional(fullwhole()),
          ),
        ),
        dec => dec ?? 0,
      ),
      Σ.map(
        Σ.optional(
          Σ.sequence(
            Σ.oneOf("ED"),
            Σ.optional(Σ.oneOf("+-")),
            fullwhole(),
          ),
        ),
        (parsed) => {
          if (parsed) {
            const [,sign, exp] = parsed
            return (sign === "-" ? -1 : 1) * exp
          }
          else {
            return 0
          }
        },
      ),
    ),
    ([sign, int, dec, exp]) => Number.parseFloat(`${sign ?? "+"}${int}.${dec}E${exp}`),
  )
}

// Parses a comment or end of line
function fitscomment(): Σ.Parser<string | null> {
  return Σ.choice(
    Σ.takeMid(
      Σ.string("/"),
      Σ.map(Σ.rest(), rest => rest.trimEnd()),
      Σ.eof(),
    ),
    Σ.eof(),
  )
}

const KeywordRecordParser = Σ.when(
  Σ.map(
    Σ.regexp(/[A-Z0-9 _-]{8}/g, "keyword"),
    keyword => keyword.trimEnd(),
  ),
  ({ value: name }): Σ.Parser<FITSHeaderKeyword> => {
    switch (name) {
      case "": {
        return Σ.map(Σ.rest(), value => ({ name, value: undefined, comment: value.trimEnd() }))
      }
      case "HISTORY":
      case "COMMENT": {
        return Σ.map(
          Σ.sequence(
            Σ.oneOf("= "), // older versions might have an `=` here, but they shouldn't have
            spaces(), // at least one space after the previous one
            Σ.rest(),
          ),
          ([,,value]) => ({ name, value: undefined, comment: value.trimEnd() }),
        )
      }
      case "CONTINUE": {
        return Σ.map(
          Σ.sequence(
            Σ.oneOf("= "), // older versions might have an `=` here, but they shouldn't have
            spaces(), // at least one space after the previous one
            fitsstring(),
            spaces(),
            fitscomment(),
          ),
          ([,,value,,comment]) => ({ name, value, comment }),
        )
      }
      case "END": {
        return Σ.map(
          Σ.sequence(spaces(), Σ.eof()),
          () => ({ name, value: undefined, comment: null }),
        )
      }
      default: {
        return Σ.map(
          Σ.takeRight(
            Σ.sequence(Σ.string("="), spaces()),
            Σ.takeSides(
              Σ.choice(
              // Logical value
                Σ.mapTo(Σ.string("T"), true),
                Σ.mapTo(Σ.string("F"), false),
                // String value
                fitsstring(),
                // Interger/floating-point value
                fitsfloat(),
                // Complex (integer and floating-point) value
                Σ.map(
                  Σ.sequence(
                    Σ.string("("),
                    Σ.optional(spaces()),
                    fitsfloat(),
                    Σ.optional(spaces()),
                    Σ.string(","),
                    Σ.optional(spaces()),
                    fitsfloat(),
                    Σ.optional(spaces()),
                    Σ.string(")"),
                  ),
                  ([,,real,,,,img,,]) => [real, img] satisfies [real: number, imaginary: number],
                ),
                // Undefined value
                Σ.mapTo(spaces(), undefined),
              ),
              spaces(),
              fitscomment(),
            ),
          )
          , ([value, comment]) => ({ name, value, comment }),
        )
      }
    }
  },
)

/**
 * Parses a FITS file and returns its header and data.
 *
 * @param {ArrayBuffer} file The FITS file to parse.
 * @throws {FITSParserError} If the FITS file is invalid.
 * @returns {FITSFile} The header and data of the FITS file.
 */
export function parseFITS<NAxis extends NAxisRange>(file: ArrayBuffer, forceNaxis?: NAxis): FITSFile<NAxis> {
  let offset = 0

  const ascii = new TextDecoder("ascii")
  const header = new Map<string, FITSHeaderKeyword["value"]>()
  const keywords: FITSHeaderKeyword[] = []
  for (;; offset += KEYWORD_RECORD_SIZE) {
    // Validate the record size
    const buffer = file.slice(offset, offset + KEYWORD_RECORD_SIZE)
    if (buffer.byteLength < KEYWORD_RECORD_SIZE) {
      throw new FITSParserError("MALFORMED_KEYWORD_RECORD", offset)
    }

    // Parse the record
    const record = ascii.decode(buffer)
    const result = Σ.run(KeywordRecordParser).with(record)

    if (result.isOk) {
      keywords.push(result.value)
      const { name: keyword, value } = result.value

      if (keyword === "END") {
        break
      }

      if (keyword === "" || keyword === "COMMENT" || keyword === "HISTORY") {
        continue
      }

      if (keyword === "CONTINUE") {
        const previous = keywords.at(-1)
        const old = previous && header.get(previous.name)
        if (typeof old === "string" && old.at(-1) === "&") {
          header.set(previous!.name, old.slice(0, -1) + value)
        }
        continue
      }

      if (header.has(keyword)) {
        throw new FITSParserError("REPEATED_KEYWORD", offset)
      }

      switch (true) {
        case (keyword === "SIMPLE"): {
          if (value !== true) {
            throw new FITSParserError("NOT_STANDARD", offset)
          }
          break
        }

        case (keyword === "BITPIX"): {
          if (value !== 8 && value !== 16 && value !== 32 && value !== -32 && value !== -64) {
            throw new FITSParserError("NOT_STANDARD", offset)
          }
          break
        }

        // Integers
        case (keyword === "BLANK"):
        case (keyword === "EXTLEVEL"):
        case (keyword === "EXTVER"):
        case (keyword === "GCOUNT"):
        case (/^NAXIS\d*$/.test(keyword)):
        case (keyword === "PCOUNT"):
        case (/^TBCOL\d+$/.test(keyword)):
        case (keyword === "TFIELDS"):
        case (keyword === "THEAP"):
        {
          if (!Number.isInteger(value)) {
            throw new FITSParserError("NOT_STANDARD", offset)
          }
          break
        }

        // Reals
        case (keyword === "BSCALE"):
        case (keyword === "BZERO"):
        case (/^CDELT\d*$/.test(keyword)):
        case (/^CROTA\d*$/.test(keyword)):
        case (/^CRPIX\d*$/.test(keyword)):
        case (/^CRVAL\d*$/.test(keyword)):
        case (keyword === "DATAMAX"):
        case (keyword === "DATAMIN"):
        case (keyword === "EPOCH"):
        case (keyword === "EQUINOX"):
        case (/^PSCAL\d+$/.test(keyword)):
        case (/^PZERO\d+$/.test(keyword)):
        case (/^TSCAL\d+$/.test(keyword)):
        case (/^TZERO\d+$/.test(keyword)):
        {
          if (!Number.isFinite(value)) {
            throw new FITSParserError("NOT_STANDARD", offset)
          }
          break
        }

        // Strings
        case (keyword === "AUTHOR"):
        case (keyword === "BUNIT"):
        case (/^CTYPE\d*$/.test(keyword)):
        case (keyword === "DATE"):
        case (keyword === "DATE-OBS"):
        case (keyword === "EXTNAME"):
        case (keyword === "INSTRUME"):
        case (keyword === "OBJECT"):
        case (keyword === "OBSERVER"):
        case (keyword === "ORIGIN"):
        case (/^PTYPE\d*$/.test(keyword)):
        case (keyword === "REFERENC"):
        case (/^TDIM\d*$/.test(keyword)):
        case (/^TDISP\d*$/.test(keyword)):
        case (keyword === "TELESCOP"):
        case (/^TFORM\d*$/.test(keyword)):
        case (/^TTYPE\d*$/.test(keyword)):
        case (/^TUNIT\d*$/.test(keyword)):
        case (keyword === "XTENSION"):
        {
          if (typeof value !== "string") {
            throw new FITSParserError("NOT_STANDARD", offset)
          }
          break
        }

        // Logical
        case (keyword === "BLOCKED"):
        case (keyword === "EXTEND"):
        case (keyword === "GROUPS"):
        {
          if (typeof value !== "boolean") {
            throw new FITSParserError("NOT_STANDARD", offset)
          }
          break
        }

        case (/^TNULL\d+$/.test(keyword)): {
          if (typeof value !== "string" && !Number.isInteger(value)) {
            throw new FITSParserError("NOT_STANDARD", offset)
          }
          break
        }
      }
      header.set(keyword, value)
    }
    else {
      throw new FITSParserError("MALFORMED_KEYWORD_RECORD", offset + result.span[0])
    }
  }

  // Validate mandatory headers
  const bitpix = header.get("BITPIX")
  const naxis = header.get("NAXIS")
  if (!header.has("SIMPLE") || !bitpix || !naxis) {
    throw new FITSParserError("NOT_STANDARD")
  }

  if (forceNaxis && naxis !== forceNaxis) {
    throw new FITSParserError("MISMATCHED_NAXIS")
  }

  const naxisArray = Array.from({ length: naxis as number }, (_, i) => header.get(`NAXIS${i + 1}`) as number).reverse()
  if (naxisArray.length !== naxis || naxisArray.some(n => typeof n !== "number")) {
    throw new FITSParserError("NOT_STANDARD")
  }

  // Align the offset to the next block
  offset = Math.ceil(offset / BLOCK_SIZE) * BLOCK_SIZE

  let data: any
  if (naxis <= 0) {
    data = null
  }
  else {
    const view = new DataView(file, 0)
    const readAxis = (axis: number[]): any => {
      if (axis.length === 0) {
        let value: number
        switch (bitpix) {
          case 8: {
            value = view.getInt8(offset)
            break
          }
          case 16: {
            value = view.getInt16(offset, false)
            break
          }
          case 32: {
            value = view.getInt32(offset, false)
            break
          }
          case 64: {
            // value = view.getBigInt64(offset, false)
            // break
            throw new RangeError("64-bit integers are not supported")
          }
          case -32: {
            value = view.getFloat32(offset, false)
            break
          }
          case -64: {
            value = view.getFloat64(offset, false)
            break
          }
          default: throw new RangeError("unexpected bitpix")
        }
        offset += Math.abs(bitpix) / 8
        return value
      }
      else {
        const [el, ...others] = axis
        const arr = []
        for (let i = 0; i < el; i++) {
          arr.push(readAxis(others))
        }
        return arr
      }
    }
    data = readAxis(naxisArray)
  }

  return {
    header: Object.fromEntries(header) as FITSHeader<NAxis>,
    keywords,
    data,
  }
}
