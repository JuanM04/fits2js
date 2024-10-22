import type { FITSHeaderValue } from "./standard.js"
import * as Σ from "@nrsk/sigma"

export interface FITSHeaderRecord {
  name: string
  value: FITSHeaderValue
  comment: string | undefined
}

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
function fitscomment(): Σ.Parser<string | undefined> {
  return Σ.choice(
    Σ.takeMid(
      Σ.string("/"),
      Σ.map(Σ.rest(), rest => rest.trimEnd()),
      Σ.eof(),
    ),
    Σ.mapTo(Σ.eof(), undefined),
  )
}

export const KeywordRecordParser = Σ.when(
  Σ.map(
    Σ.regexp(/[A-Z0-9 _-]{8}/g, "keyword"),
    keyword => keyword.trimEnd(),
  ),
  ({ value: name }): Σ.Parser<FITSHeaderRecord> => {
    switch (name) {
      case "": {
        return Σ.map(Σ.rest(), value => ({ name, value: undefined, comment: value.trimEnd() }))
      }
      case "HISTORY":
      case "COMMENT": {
        return Σ.map(
          Σ.rest(),
          value => ({ name, value: undefined, comment: value.trimEnd() }),
        )
      }
      case "CONTINUE": {
        return Σ.map(
          Σ.sequence(
            spaces(),
            fitsstring(),
            spaces(),
            fitscomment(),
          ),
          ([,value,,comment]) => ({ name, value, comment }),
        )
      }
      case "END": {
        return Σ.map(
          Σ.sequence(spaces(), Σ.eof()),
          () => ({ name, value: undefined, comment: undefined }),
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
