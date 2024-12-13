/* eslint-disable regexp/no-useless-non-capturing-group */
/* eslint-disable regexp/no-super-linear-backtracking */

/**
 * @fileoverview
 * According to the FITS standard, "Card image" is an obsolete term for an 80-character keyword record derived from the
 * 80-column punched computer cards that were prevalent in the 1960s and 1970s.
 *
 * All the logic related to parsing cards (or "keyword records") is contained in this file.
 */

const CARD_LENGTH = 80
const KEYWORD_LENGTH = 8
const VALUE_INDICATOR = "= "

const COMMENTARY_KEYWORDS = ["", "HISTORY", "COMMENT", "END"] as const
const SPECIAL_KEYWORDS = [...COMMENTARY_KEYWORDS, "CONTINUE"] as const

/**
 * Possible values associated with a FITS header card.
 * `null` is used to represent an undefined value, like for a `END` card.
 */
export type FITSCardValue = string | number | [real: number, imaginary: number] | boolean | null

// About these regexes:
// - [\x20-\x7E] matches all printable ASCII characters
// - [\x20-\x26\x28-\x7E] matches all printable ASCII characters characters except single quotes
// - [\x20-\x3C\x3E-\x7E] matches all printable ASCII characters characters except equal signs

const keywordRegex = /^[A-Z0-9_-]{0,8}$/g
const hierarchRegex = /^HIERARCH {2}[\x20-\x3C\x3E-\x7E]+$/g
const asciiRegex = /^[\x20-\x7E]*$/g

const numberRegex = String.raw`[+-]?(?:\.\d+|\d+(?:\.\d*)?)(?:[DE][+-]?\d+)?`
const valueCommentRegex = new RegExp(
  [
    "^=? *(?:",
    [
      "'(?<value_str>(?:[\\x20-\\x26\\x28-\\x7E]|'')*?) *'",
      "(?<value_bool>[FT])",
      `(?<value_real>${numberRegex})`,
      `(?:\\( *(?<value_cplx_r>${numberRegex}) *, *(?<value_cplx_i>${numberRegex}) *\\))`,
    ].join("|"),
    ") *(?:\\/ *(?<comment>.+?) *)?$",
  ].join(""),
)

/**
 * Formats a real number to a string according to the FITS standard.
 * It its trimmed to fit a 20-character limit.
 *
 * @param {number} number The number to convert.
 * @returns {string} The string representation of the number.
 */
function realToString(number: number): string {
  let output = number.toString().replace("e", "E")
  const len = output.length
  if (len > 20) {
    let [mantissa, exponent] = output.split("E")
    mantissa = mantissa.slice(0, 20 - exponent.length)
    output = exponent.length > 0 ? `${mantissa}E${exponent}` : mantissa
  }
  return output
}

/**
 * Converts a FITS number value to a JavaScript number.
 *
 * @param {string} number The number to convert.
 * @returns {number} The converted number.
 */
function stringToReal(number: string): number {
  return Number.parseFloat(number.replace(/[de]/gi, "e"))
}

/**
 * Converts a FITS card value to a string.
 * If `fixFrom` is a number, the value is formatted according to the FITS fixed format.
 * This is, the value should be right-justified to the byte 30. `fixFrom` is the byte
 * where the value starts. This is required because the HIERARCH keyword is not fixed.
 * in length.
 *
 * @param {FITSCardValue} value The value to convert.
 * @param {number|null} fixFrom Whether to format the value according to the FITS fixed format.
 * @returns {string} The string representation of the value.
 */
function valueToString(value: FITSCardValue, fixFrom: number | null): string {
  if (typeof value === "string") {
    const raw = `'${value.replaceAll("'", "''")}'`
    // FITS fixed format -- strings are left-justified,
    // so we pad them with spaces to the right
    if (fixFrom !== null) return raw.padEnd(30 - fixFrom, " ")
    else return `'${value}'`
  }

  let raw = ""
  if (value === null) {
    raw = ""
  }
  else if (typeof value === "boolean") {
    raw = value ? "T" : "F"
  }
  else if (typeof value === "number") {
    raw = realToString(value)
  }
  else if (Array.isArray(value)) {
    raw = `(${realToString(value[0])},${realToString(value[1])})`
  }
  else {
    throw new TypeError(`Invalid FITS card value: ${value}`)
  }

  // FITS fixed format
  if (fixFrom !== null) return raw.padStart(30 - fixFrom, " ")
  else return raw
}

/**
 * A FITS header card image, also known as a "keyword record".
 */
export class Card {
  /** Card length, fixes as per the FITS standard. */
  static readonly LENGTH = CARD_LENGTH

  private constructor(
    /** The verbatim 80-character keyword record. */
    readonly image: string,
    /** The keyword of the card. */
    readonly keyword: string,
    /** The parsed value of the card. */
    readonly value: FITSCardValue,
    /**
     * The comment (if any) of the card.
     * It is trimmed for convinience, the original can be retrieved from {@link image}.
     */
    readonly comment: string | null,
  ) {};

  /** Returns whether the card is all spaces. */
  public get isBlank(): boolean {
    return /^\s+$/.test(this.image)
  }

  /** Returns whether the card has a HIERARCH keyword. */
  public get isHierarch(): boolean {
    return this.image.startsWith("HIERARCH")
  }

  public toString(): string {
    return this.image
  }

  public toJSON(): unknown {
    return { keyword: this.keyword, value: this.value, comment: this.comment }
  }

  /**
   * Creates a new card from a keyword, value, and comment.
   *
   * @param {string} keyword The keyword of the card.
   * @param {FITSCardValue} value The value of the card.
   * @param {string | null} [comment] The comment of the card.
   * @throws {RangeError} If the HIERARCH keyword is too long.
   * @throws {TypeError} If the keyword is invalid or the card is too long.
   * @throws {TypeError} If the card is an END card with a value or comment.
   * @throws {TypeError} If the card is a CONTINUE card with a non-string value.
   * @throws {TypeError} If the value or comment is not an ASCII string.
   * @throws {RangeError} If the card is too long.
   * @returns {Card} The created card.
   */
  static fromValue(keyword: string, value: FITSCardValue, comment: string | null = null): Card {
    keyword = keyword.trimEnd()
    if (hierarchRegex.test(keyword)) {
      if (keyword.length > CARD_LENGTH) {
        throw new RangeError(`HIERARCH keyword \`${keyword}\` is too long: must be less than ${CARD_LENGTH} characters`)
      }
    }
    if (!keywordRegex.test(keyword)) {
      throw new TypeError(`Invalid keyword \`${keyword}\`: must match ${keywordRegex}`)
    }
    if (keyword === "END" && (value !== null || comment !== null)) {
      throw new TypeError("END card must have no value or comment")
    }
    if (keyword === "CONTINUE" && (typeof value !== "string")) {
      throw new TypeError("CONTINUE card must have a string value")
    }

    if (typeof value === "string" && !asciiRegex.test(value)) {
      throw new TypeError(`Invalid value \`${value}\`: must be an ASCII string`)
    }

    if (comment !== null && !asciiRegex.test(comment)) {
      throw new TypeError(`Invalid comment \`${comment}\`: must be an ASCII string`)
    }

    let image = ""

    if (hierarchRegex.test(keyword)) {
      image = `${keyword} `
    }
    else {
      image = keyword.padEnd(KEYWORD_LENGTH, " ")
    }

    if (SPECIAL_KEYWORDS.includes(keyword as unknown as any)) {
      image += "  "
    }
    else {
      image += VALUE_INDICATOR
    }

    let imageValue = valueToString(value, image.length)
    let commentValue = comment !== null ? ` / ${comment}`.trimEnd() : ""

    if (image.length + imageValue.length + commentValue.length > CARD_LENGTH) {
      imageValue = valueToString(value, null)
      if (image.length + imageValue.length + commentValue.length > CARD_LENGTH) {
        const maxCommentLength = CARD_LENGTH - image.length - imageValue.length
        if (maxCommentLength < 0) {
          throw new RangeError(`Cannot create a card with a keyword \`${keyword}\` and value \`${value}\` that exceeds ${CARD_LENGTH} characters`)
        }
        else if (maxCommentLength < 6) {
          // no comment whatsoever
          commentValue = ""
          comment = null
          console.warn(`Comment for card \`${keyword}\` is too long: it will be removed`)
        }
        else {
          // trimmed comment
          comment = `${comment!.slice(0, maxCommentLength - 6)}...`
          commentValue = ` / ${comment}`
          console.warn(`Comment for card \`${keyword}\` is too long: trimmed to ${maxCommentLength} characters`)
        }
      }
    }

    image = `${image}${imageValue}${commentValue}`.padEnd(CARD_LENGTH, " ")

    return new Card(image, keyword, value, comment)
  }

  /**
   * Parses a card image into a {@link Card} instance.
   *
   * @param {string} image The card image to parse.
   * @param {boolean} [pad] Whether to pad the image to 80 characters if it is shorter.
   * @returns {Card} The parsed card.
   */
  static fromString(image: string, pad: boolean = true): Card {
    if (pad) {
      image = image.padEnd(Card.LENGTH, " ")
    }
    else if (image.length !== Card.LENGTH) {
      throw new Error(`Card image must be exactly ${Card.LENGTH} characters long, but got ${image.length}`)
    }

    let keyword = image.slice(0, KEYWORD_LENGTH).trimEnd()
    let valueComment = image.slice(KEYWORD_LENGTH)
    if (COMMENTARY_KEYWORDS.includes(keyword as unknown as any)) {
      let value = valueComment.startsWith(VALUE_INDICATOR) ? valueComment.slice(VALUE_INDICATOR.length) : valueComment
      value = value.trim()
      return new Card(image, keyword, value, null)
    }

    if (keyword === "HIERARCH") {
      const vi = valueComment.indexOf(VALUE_INDICATOR)
      keyword = valueComment.slice(0, vi).trimEnd()
      valueComment = valueComment.slice(vi + VALUE_INDICATOR.length)
    }

    const result = valueCommentRegex.exec(valueComment)?.groups
    if (!result) {
      throw new Error(`Failed to parse card image \`${image}\``)
    }

    const comment = result.comment ?? null
    const value: FITSCardValue = typeof result.value_str === "string"
      ? result.value_str
      : result.value_bool
        ? result.value_bool === "T"
        : result.value_real
          ? stringToReal(result.value_real)
          : (result.value_cplx_r && result.value_cplx_i)
              ? [stringToReal(result.value_cplx_r), stringToReal(result.value_cplx_i)]
              : null

    if (keyword === "CONTINUE" && typeof value !== "string") {
      throw new TypeError(`Failed to parse card image \`${image}\`: CONTINUE card must have a string value`)
    }

    return new Card(image, keyword, value, comment)
  }
}
