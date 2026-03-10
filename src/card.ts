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
const FIXED_VALUE_LENGTH = 30
const VALUE_INDICATOR = "= "
const COMMENT_SEPARATOR = " / "

const COMMENTARY_KEYWORDS = ["", "HISTORY", "COMMENT"] as const

/**
 * Possible values associated with a FITS header card.
 * `null` is used to represent an undefined value, like for a `END` card.
 */
export type FITSCardValue = string | number | [real: number, imaginary: number] | boolean | null

// About these regexes:
// - [\x20-\x7E] matches all printable ASCII characters
// - [\x20-\x26\x28-\x7E] matches all printable ASCII characters characters except single quotes
// - [\x20-\x3C\x3E-\x7E] matches all printable ASCII characters characters except equal signs

const keywordRegex = /^[A-Z0-9_-]{0,8}$/
const hierarchRegex = /^HIERARCH {2}[\x20-\x3C\x3E-\x7E]+$/
const asciiRegex = /^[\x20-\x7E]*$/

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
 * Returns whether the given keyword is a commentary keyword, defined in Section "4.4.2.4. Commentary keywords" of the
 * FITS standard 4.0.
 *
 * @param {string} keyword The keyword to check.
 * @returns {boolean} Whether the keyword is a commentary keyword.
 */
export function keywordIsCommentary(keyword: string): keyword is (typeof COMMENTARY_KEYWORDS)[number] {
  return COMMENTARY_KEYWORDS.includes(keyword as unknown as any)
}

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
 * Normalize a FITS string, removing trailing spaces or replacing all-spaces strings with a single space.
 *
 * @param {string} value The string to normalize.
 * @returns {string} The normalized string.
 */
function normalizeFITSString(value: string): string {
  if (/^ +$/.test(value)) {
    // value is all spaces -- FITS standard says to represent as a single space
    return " "
  }
  else {
    // if not, trim trailing spaces. this includes null strings
    return value.trimEnd()
  }
}

/**
 * Escape single quotes in a FITS string value by doubling them.
 *
 * @param {string} value The string to escape.
 * @returns {string} The escaped string.
 */
function escapeFITSString(value: string): string {
  return value.replaceAll("'", "''")
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
    const raw = `'${escapeFITSString(normalizeFITSString(value))}'`
    // FITS fixed format -- strings are left-justified,
    // so we pad them with spaces to the right
    if (fixFrom !== null) return raw.padEnd(FIXED_VALUE_LENGTH - fixFrom, " ")
    else return raw
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
  if (fixFrom !== null) return raw.padStart(FIXED_VALUE_LENGTH - fixFrom, " ")
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

  /** Returns whether the card is a commentary card. */
  public get isCommentary(): boolean {
    return keywordIsCommentary(this.keyword)
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
   * @throws {TypeError} If the card is a commentary card with a value.
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

    if (keyword === "END") {
      if (value !== null || comment !== null) throw new TypeError("END card must have no value or comment")
      const image = "END".padEnd(CARD_LENGTH, " ")
      return new Card(image, keyword, null, null)
    }

    if (keywordIsCommentary(keyword)) {
      if (value !== null) throw new TypeError(`Commentary card \`${keyword}\` must have no value`)
      let image = keyword.padEnd(KEYWORD_LENGTH, " ")
      if (keyword !== "") image += " " // don't add space at byte 9 for blank keyword cards
      image += (comment ?? "").trimEnd()
      if (image.length > CARD_LENGTH) {
        throw new RangeError(`Cannot create a card with a keyword \`${keyword}\` and comment \`${value}\` that exceeds ${CARD_LENGTH} characters`)
      }
      image = image.padEnd(CARD_LENGTH, " ")
      return new Card(image, keyword, null, comment)
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

    image += VALUE_INDICATOR
    let imageValue = valueToString(value, image.length)
    let commentValue = comment !== null ? `${COMMENT_SEPARATOR}${comment}`.trimEnd() : ""

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
          commentValue = `${COMMENT_SEPARATOR}${comment}`
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
  static fromImage(image: string, pad: boolean = true): Card {
    if (pad) {
      image = image.padEnd(Card.LENGTH, " ")
    }
    else if (image.length !== Card.LENGTH) {
      throw new Error(`Card image must be exactly ${Card.LENGTH} characters long, but got ${image.length}`)
    }

    let keyword = image.slice(0, KEYWORD_LENGTH).trimEnd()
    let valueComment = image.slice(KEYWORD_LENGTH)
    if (keywordIsCommentary(keyword)) {
      let comment = valueComment.startsWith(VALUE_INDICATOR) ? valueComment.slice(VALUE_INDICATOR.length) : valueComment
      comment = comment.trim()
      return new Card(image, keyword, null, comment)
    }

    if (keyword === "END") {
      if (/[^ ]/.test(valueComment)) throw new Error(`END can't have any non-space characters after the keyword`)
      return new Card(image, keyword, null, null)
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

  /**
   * Creates a new card from a keyword, value, and comment. It optimizes for CONTINUE cards if the string value is too
   * long. When adding comments, it might split the string into multiple CONTINUE cards as needed, optimizing for the
   * minimum number of cards of equal-length strings.
   *
   * @param {string} keyword The keyword of the card.
   * @param {string} value The value of the card.
   * @param {string | null} [comment] The comment of the card.
   * @throws {RangeError} If the HIERARCH keyword is too long.
   * @throws {TypeError} If the keyword is invalid.
   * @throws {TypeError} If the keyword is commentary, CONTINUE or END.
   * @throws {TypeError} If the value or comment is not an ASCII string.
   * @throws {Error} If the value or comment could not be split into CONTINUE cards.
   * @returns {Card[]} The created cards.
   */
  static buildString(keyword: string, value: string, comment: string | null = null): Card[] {
    keyword = keyword.trimEnd()
    if (!keywordRegex.test(keyword)) {
      throw new TypeError(`Invalid keyword \`${keyword}\`: must match ${keywordRegex}`)
    }
    if (keywordIsCommentary(keyword) || keyword === "CONTINUE" || keyword === "END") {
      throw new TypeError(`Keyword \`${keyword}\` cannot be used with fromString`)
    }

    if (!asciiRegex.test(value)) {
      throw new TypeError(`Invalid value \`${value}\`: must be an ASCII string`)
    }
    value = escapeFITSString(normalizeFITSString(value))

    if (comment) {
      if (!asciiRegex.test(comment)) {
        throw new TypeError(`Invalid comment \`${comment}\`: must be an ASCII string`)
      }
      comment = comment?.trim() || null
    }

    const LENGTH_AVAILABLE = CARD_LENGTH - KEYWORD_LENGTH - VALUE_INDICATOR.length - 2 // 2 for quotes
    const SEP_LENGTH = COMMENT_SEPARATOR.length

    // Edge-cases for short values
    if (value.length + (comment ? comment.length + SEP_LENGTH : 0) <= LENGTH_AVAILABLE) {
      const commentLength = comment ? comment.length + SEP_LENGTH : 0
      let image = keyword.padEnd(KEYWORD_LENGTH, " ")
      image += VALUE_INDICATOR
      if (value.length < 8 && 8 + commentLength <= LENGTH_AVAILABLE) {
        // Pad string to length 8 for backwards compatibility
        image += `'${value.padEnd(8, " ")}'`
      }
      else {
        image += `'${value}'`
      }
      if (comment) {
        if (image.length < FIXED_VALUE_LENGTH && commentLength + FIXED_VALUE_LENGTH < CARD_LENGTH) {
          // FITS fixed format -- justify comment to byte 30
          image = image.padEnd(FIXED_VALUE_LENGTH, " ")
        }
        image += `${COMMENT_SEPARATOR}${comment}`
      }
      image = image.padEnd(CARD_LENGTH, " ")

      return [new Card(image, keyword, value.trimEnd(), comment)]
    }

    // The general case for long strings requiring CONTINUE cards
    const commentParts = comment ? comment.split(" ") : []
    const minimumCommentLength = comment ? commentParts.reduce((max, part) => part.length > max ? part.length : max, 0) + SEP_LENGTH : 0

    // Find the best split that minimizes the number of cards
    // In order, we prioritize:
    // 1. Minimum number of cards (n)
    // 2. Minimum number of empty strings (emptyStrings)
    // 3. Minimum number of empty comments (emptyComments)
    const bestCase = {
      n: Infinity,
      emptyStrings: 0,
      emptyComments: 0,
      cards: [] as Card[],
    }

    // Try different string lengths to find the minimum number of cards
    // Since whe split the comment into words, we need to ensure that the longest word can fit in the remaining space
    for (let strLength = LENGTH_AVAILABLE - minimumCommentLength; strLength > 1; strLength--) {
      const cards: Card[] = []
      let remainingString = value
      const remainingComment = [...commentParts]
      while (remainingString.length > 0 || remainingComment.length > 0) {
        let image = ""
        const cardKeyword = cards.length === 0 ? keyword : "CONTINUE"
        image += cardKeyword.padEnd(KEYWORD_LENGTH, " ")
        if (cardKeyword === "CONTINUE") image += "  "
        else image += VALUE_INDICATOR
        let str = remainingString.length > strLength
          ? remainingString.slice(0, strLength - 1) // -1 to leave space for &
          : remainingString
        if (str.at(-1) === "'" && str.match(/'/g)!.length % 2 === 1) {
          // Avoid splitting on an escaped quote
          str = str.slice(0, -1)
        }
        remainingString = remainingString.slice(str.length)
        str += "&"
        image += `'${str}'`
        image = image.padEnd(KEYWORD_LENGTH + VALUE_INDICATOR.length + strLength + 2, " ") // 2 for quotes
        let cardComment: string | null = null
        if (remainingComment.length > 0) {
          image += COMMENT_SEPARATOR
          cardComment = remainingComment.shift()! // guaranteed to fit
          while (remainingComment.length > 0) {
            const nextPart = remainingComment[0]
            if (image.length + cardComment.length + nextPart.length + 1 > CARD_LENGTH) break
            cardComment += ` ${nextPart}`
            remainingComment.shift()
          }
          image += cardComment
        }
        image = image.padEnd(CARD_LENGTH, " ")
        if (remainingString.length > 0 || remainingComment.length > 0) {
          cards.push(new Card(image, cardKeyword, str, cardComment))
        }
        else {
          // Last card -- remove & from end of string
          str = str.slice(0, -1)
          const ampIndex = KEYWORD_LENGTH + VALUE_INDICATOR.length + str.length + 1 // 1 for opening quote
          image = `${image.slice(0, ampIndex)}' ${image.slice(ampIndex + 2)}`
          cards.push(new Card(image, cardKeyword, str, cardComment))
        }
      }
      const emptyStrings = cards.filter(c => c.value === "").length
      const emptyComments = cards.filter(c => c.comment === null).length
      if (cards.length < bestCase.n
        || (cards.length === bestCase.n && emptyStrings < bestCase.emptyStrings)
        || (cards.length === bestCase.n && emptyStrings === bestCase.emptyStrings && emptyComments < bestCase.emptyComments)) {
        bestCase.n = cards.length
        bestCase.emptyStrings = emptyStrings
        bestCase.emptyComments = emptyComments
        bestCase.cards = cards
      }
    }

    if (!Number.isFinite(bestCase.n)) {
      // eslint-disable-next-line unicorn/prefer-type-error
      throw new Error("Failed to create CONTINUE cards: could not find a valid split")
    }

    return bestCase.cards
  }
}
