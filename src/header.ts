import type { FITSCardValue } from "./card.js"
import type { FITSBITPIX } from "./data.js"
import { Card, keywordIsCommentary } from "./card.js"
import { BLOCK_SIZE } from "./FITS.js"

interface FITSHeaderParsedResult {
  header: FITSHeader
  bytesRead: number
}

// Card types

export type FITSCardInteger
  = | "BITPIX"
    | "BLANK"
    | "EXTLEVEL"
    | "EXTVER"
    | "GCOUNT"
    | `NAXIS${"" | number}`
    | "PCOUNT"
    | `TBCOL${number}`
    | "TFIELDS"
    | "THEAP"
const fitsCardIntegerRegExp = /^(?:BITPIX|BLANK|EXTLEVEL|EXTVER|GCOUNT|NAXIS\d{0,3}|PCOUNT|TBCOL\d{1,3}|TFIELDS|THEAP)$/
export function isFITSCardInteger(keyword: string): keyword is FITSCardInteger {
  return fitsCardIntegerRegExp.test(keyword)
}

export type FITSCardReal
  = | "BSCALE"
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
const fitsCardRealRegExp = /^(?:BSCALE|BZERO|CDELT\d{1,3}|CROTA\d{1,3}|CRPIX\d{1,3}|CRVAL\d{1,3}|DATAMAX|DATAMIN|EPOCH|EQUINOX|PSCAL\d{1,3}|PZERO\d{1,3}|TSCAL\d{1,3}|TZERO\d{1,3})$/
export function isFITSCardReal(keyword: string): keyword is FITSCardReal {
  return fitsCardRealRegExp.test(keyword)
}

export type FITSCardString
  = | "AUTHOR"
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
const fitsCardStringRegExp = /^(?:AUTHOR|BUNIT|CTYPE\d{1,3}|DATE\S{0,4}|EXTNAME|INSTRUME|OBJECT|OBSERVER|ORIGIN|PTYPE\d{1,3}|REFERENC|TDIM\d{1,3}|TDISP\d{1,3}|TELESCOP|TFORM\d{1,3}|TTYPE\d{1,3}|TUNIT\d{1,3}|XTENSION)$/
export function isFITSCardString(keyword: string): keyword is FITSCardString {
  return fitsCardStringRegExp.test(keyword)
}

export type FITSCardLogical
  = | "BLOCKED"
    | "EXTEND"
    | "GROUPS"
    | "SIMPLE"
const fitsCardLogicalRegExp = /^(?:BLOCKED|EXTEND|GROUPS|SIMPLE)$/
export function isFITSCardLogical(keyword: string): keyword is FITSCardLogical {
  return fitsCardLogicalRegExp.test(keyword)
}

export interface FITSHeaderSetOptions {
  comment?: string | null
  index?: number
}

export interface FITSHeaderAxisOptions {
  ctype?: string
  cunit?: string
  crpix?: number
  crval?: number
  cdelt?: number
  crota?: number
}

export class FITSHeader {
  readonly #cards: Card[] = []

  private constructor(cards: Card[]) {
    this.#cards = cards
  }

  #getMandatoryCardCount(): number {
    let count = 0
    if (this.#cards[count]?.keyword === "SIMPLE") {
      count++
    }
    if (this.#cards[count]?.keyword === "BITPIX") {
      count++
    }

    const naxisCard = this.#cards[count]
    if (naxisCard?.keyword === "NAXIS"
      && typeof naxisCard.value === "number"
      && Number.isInteger(naxisCard.value)
      && naxisCard.value >= 0) {
      count++
      for (let axis = 1; axis <= naxisCard.value; axis++) {
        if (this.#cards[count]?.keyword === `NAXIS${axis}`) {
          count++
        }
        else {
          break
        }
      }
    }

    return count
  }

  #getMutableEntryStartIndices(): number[] {
    const starts: number[] = []
    for (let i = this.#getMandatoryCardCount(); i < this.#cards.length; i++) {
      if (this.#cards[i]!.keyword === "CONTINUE") {
        continue
      }

      starts.push(i)
    }

    return starts
  }

  #getMutableEntryCount(): number {
    return this.#getMutableEntryStartIndices().length
  }

  #getMutableInsertIndex(index: number): number {
    const starts = this.#getMutableEntryStartIndices()
    if (index <= 0) {
      return this.#getMandatoryCardCount()
    }
    if (index >= starts.length) {
      return this.#cards.length
    }

    return starts[index]!
  }

  #getCardBlocks(keyword: string): Array<{ cardIndex: number, length: number }> {
    const blocks: Array<{ cardIndex: number, length: number }> = []

    for (let i = 0; i < this.#cards.length; i++) {
      if (this.#cards[i]!.keyword !== keyword) {
        continue
      }

      let length = 1
      while (this.#cards[i + length]?.keyword === "CONTINUE") {
        length++
      }

      blocks.push({ cardIndex: i, length })
      i += length - 1
    }

    return blocks
  }

  #getReplacementCards(keyword: string, value: FITSCardValue, comment: string | null): Card[] {
    return typeof value === "string"
      ? Card.buildString(keyword, value, comment)
      : [Card.fromValue(keyword, value, comment)]
  }

  #assertWritableValueKeyword(keyword: string): void {
    if (keyword === "SIMPLE" || keyword === "BITPIX" || keyword.startsWith("NAXIS") || keyword === "EXTEND") {
      throw new TypeError(`Cannot set value for "${keyword}": value determined by the FITS instance`)
    }
    if (keyword === "CONTINUE") {
      throw new TypeError(`Cannot set value for "${keyword}": value determined by adyacent string`)
    }
    if (keywordIsCommentary(keyword) || keyword === "END") {
      throw new TypeError(`Cannot set value for "${keyword}": keyword cannot have a value`)
    }
  }

  #assertWritableCommentKeyword(keyword: string): void {
    if (keyword === "SIMPLE" || keyword === "BITPIX" || keyword.startsWith("NAXIS") || keyword === "EXTEND") {
      throw new TypeError(`Cannot set value for "${keyword}": comment fixed as per FITS standard`)
    }
    if (keyword === "CONTINUE") {
      throw new TypeError(`Cannot set value for "${keyword}": comment determined by adyacent card`)
    }
    if (keyword === "END") {
      throw new TypeError(`Cannot set value for "${keyword}": keyword cannot have a comment`)
    }
  }

  #assertRemovableKeyword(keyword: string): void {
    if (keyword === "SIMPLE" || keyword === "BITPIX" || keyword.startsWith("NAXIS") || keyword === "EXTEND") {
      throw new TypeError(`Cannot remove "${keyword}": keyword determined by the FITS instance`)
    }
    if (keyword === "CONTINUE" || keyword === "END") {
      throw new TypeError(`Cannot remove "${keyword}" directly`)
    }
  }

  #insertCommentaryAt(index: number, keyword: "" | "COMMENT" | "HISTORY", comment: string | null): number {
    const cardIndex = this.#getMutableInsertIndex(index)
    this.#cards.splice(cardIndex, 0, Card.fromValue(keyword, null, comment))
    return Math.max(0, Math.min(index, this.#getMutableEntryCount() - 1))
  }

  /**
   * Returns the value of all the cards matching specified header keyword.
   *
   * @param {string} keyword The keyword to retrieve.
   * @returns {FITSCardValue[]} The values of the keywords.
   */
  public getValues(keyword: FITSCardInteger | FITSCardReal): number[]
  public getValues(keyword: FITSCardLogical): boolean[]
  public getValues(keyword: FITSCardString): string[]
  public getValues(keyword: Exclude<string, FITSCardInteger | FITSCardReal | FITSCardLogical | FITSCardString>): FITSCardValue[]
  public getValues(keyword: string): FITSCardValue[] {
    keyword = keyword.trim().toUpperCase()
    if (keywordIsCommentary(keyword) || keyword === "CONTINUE" || keyword === "END") {
      throw new TypeError(`Cannot retrieve values for "${keyword}" keyword`)
    }

    const cards = this.#cards.map((c, i) => [c, i] as const).filter(([card]) => card.keyword === keyword)

    const values = []
    for (const [card, index] of cards) {
      // Validate standard compliance

      if (isFITSCardInteger(card.keyword)) {
        if (typeof card.value !== "number" || !Number.isInteger(card.value)) {
          throw new TypeError(`Expected ${card.keyword} to be an integer, but got ${card.value} [${typeof card.value}]`)
        }
      }
      else if (isFITSCardReal(card.keyword)) {
        if (typeof card.value !== "number" || !Number.isFinite(card.value)) {
          throw new TypeError(`Expected ${card.keyword} to be an real, but got ${card.value} [${typeof card.value}]`)
        }
      }
      else if (isFITSCardLogical(card.keyword)) {
        if (typeof card.value !== "boolean") {
          throw new TypeError(`Expected ${card.keyword} to be a logical, but got ${card.value} [${typeof card.value}]`)
        }
      }
      else if (isFITSCardString(card.keyword)) {
        if (typeof card.value !== "string") {
          throw new TypeError(`Expected ${card.keyword} to be a string, but got ${card.value} [${typeof card.value}]`)
        }
      }

      if (typeof card.value === "string") {
        let v = card.value
        let i = index
        let next = this.#cards.at(++i)
        while (v.endsWith("&") && next?.keyword === "CONTINUE") {
          if (typeof next.value !== "string") throw new TypeError(`Malformed CONTINUE card: ${next.value}`)
          v = v.slice(0, -1) + next.value
          next = this.#cards.at(++i)
        }
        values.push(v)
      }
      else {
        values.push(card.value)
      }
    }

    return values
  }

  /**
   * Returns the value of the first card matching specified header keyword.
   *
   * @param {string} keyword The keyword to retrieve.
   * @returns {FITSCardValue | undefined} The value of the keyword, or `undefined` if the keyword is not present.
   */
  public getValue(keyword: FITSCardInteger | FITSCardReal): number | undefined
  public getValue(keyword: FITSCardLogical): boolean | undefined
  public getValue(keyword: FITSCardString): string | undefined
  public getValue(keyword: Exclude<string, FITSCardInteger | FITSCardReal | FITSCardLogical | FITSCardString>): FITSCardValue | undefined
  public getValue(keyword: string): FITSCardValue | undefined {
    return this.getValues(keyword).at(0)
  }

  /**
   * Sets the value of the i-th card matching specified header keyword. If the keyword is not present, it will be
   * created. If the value is `undefined`, the keyword will be removed.
   *
   * @param {string} keyword The keyword to set.
   * @param {FITSCardValue | undefined} value The value to set.
   * @param {number} [index=0] The index of the card to set. If the index is out of bounds, the value will be appended.
   * @returns {number} The index of the card that was set.
   */
  public setValue(keyword: FITSCardInteger | FITSCardReal, value: number | undefined, index: number): number
  public setValue(keyword: FITSCardLogical, value: boolean | undefined, index: number): number
  public setValue(keyword: FITSCardString, value: string | undefined, index: number): number
  public setValue(keyword: Exclude<string, FITSCardInteger | FITSCardReal | FITSCardLogical | FITSCardString>, value: FITSCardValue | undefined, index: number): number
  public setValue(keyword: string, value: FITSCardValue | undefined, index: number = 0): number {
    return this.set(keyword, value, { index })
  }

  /**
   * Returns the comments of all the cards matching specified header keyword.
   *
   * @param {string} keyword The keyword to retrieve.
   * @returns {(string | null)[]} The values of the comments. `null` indicates a keyword without a comment.
   */
  public getComments(keyword: string): (string | null)[] {
    keyword = keyword.trim().toUpperCase()
    if (keyword === "CONTINUE" || keyword === "END") {
      throw new TypeError(`Cannot retrieve values for "${keyword}" keyword`)
    }

    const cards = this.#cards.map((c, i) => [c, i] as const).filter(([card]) => card.keyword === keyword)

    const values: (string | null)[] = []
    for (const [card, index] of cards) {
      if (typeof card.value === "string") {
        const c = [card.comment]
        let v = card.value
        let i = index
        let next = this.#cards.at(++i)
        while (v.endsWith("&") && next?.keyword === "CONTINUE") {
          if (typeof next.value !== "string") throw new TypeError(`Malformed CONTINUE card: ${next.value}`)
          v = next.value
          c.push(next.comment)
          next = this.#cards.at(++i)
        }
        const comment = c.filter(Boolean).join(" ")
        values.push(comment === "" ? null : comment)
      }
      else {
        values.push(card.comment)
      }
    }

    return values
  }

  /**
   * Returns the comment of the first cards matching specified header keyword.
   *
   * @param {string} keyword The keyword to retrieve.
   * @returns {string | null | undefined} The value of the comment, `null` if there is a keyword without comment or
   *                                      `undefined` if the keyword is not present.
   */
  public getComment(keyword: string): string | null | undefined {
    return this.getComments(keyword).at(0)
  }

  /**
   * Sets the comment of the i-th card matching specified header keyword. If the keyword is not present, it will throw
   * a `ReferenceError`. If the value is `null`, the comment will be removed.
   *
   * @param {string} keyword The keyword to set.
   * @param {string | null} comment The comment to set.
   * @param {number} [index] The index of the card to set the comment. If the index is out of bounds, it will throw a
   *                         `ReferenceError`.
   * @returns {number} The index of the card that was set.
   */
  public setComment(keyword: string, comment: string | null, index: number = 0): number {
    keyword = keyword.trimEnd()
    this.#assertWritableCommentKeyword(keyword)

    const blocks = this.#getCardBlocks(keyword)
    if (blocks.length <= index) {
      throw new ReferenceError(`Cannot set comment for "${keyword}" index ${index}: no such keyword present`)
    }

    const { cardIndex, length } = blocks[index]!
    const value = keywordIsCommentary(keyword)
      ? null
      : this.getValues(keyword)[index]!

    this.#cards.splice(cardIndex, length, ...this.#getReplacementCards(keyword, value, comment))
    return index
  }

  /**
   * Sets the value and optional comment of the i-th card matching the specified header keyword.
   * If the keyword is not present, it will be appended. If the value is `undefined`, the keyword will be removed.
   */
  public set(keyword: FITSCardInteger | FITSCardReal, value: number | undefined, options?: FITSHeaderSetOptions): number
  public set(keyword: FITSCardLogical, value: boolean | undefined, options?: FITSHeaderSetOptions): number
  public set(keyword: FITSCardString, value: string | undefined, options?: FITSHeaderSetOptions): number
  public set(keyword: Exclude<string, FITSCardInteger | FITSCardReal | FITSCardLogical | FITSCardString>, value: FITSCardValue | undefined, options?: FITSHeaderSetOptions): number
  public set(keyword: string, value: FITSCardValue | undefined, options: FITSHeaderSetOptions = {}): number {
    keyword = keyword.trimEnd()
    this.#assertWritableValueKeyword(keyword)

    const index = options.index ?? 0
    if (value === undefined) {
      return this.remove(keyword, index) ? index : -1
    }

    const blocks = this.#getCardBlocks(keyword)
    const comment = options.comment === undefined
      ? this.getComments(keyword)[index] ?? null
      : options.comment

    if (blocks.length <= index) {
      return this.append(keyword, value, comment)
    }

    const { cardIndex, length } = blocks[index]!
    this.#cards.splice(cardIndex, length, ...this.#getReplacementCards(keyword, value, comment))
    return index
  }

  /**
   * Appends a new card after the existing user-defined cards.
   *
   * @param {string} keyword The keyword to append.
   * @param {FITSCardValue} value The value to append.
   * @param {string | null} comment The comment to append.
   * @returns {number} The logical header entry index where the card was inserted.
   */
  public append(keyword: FITSCardInteger | FITSCardReal, value: number, comment?: string | null): number
  public append(keyword: FITSCardLogical, value: boolean, comment?: string | null): number
  public append(keyword: FITSCardString, value: string, comment?: string | null): number
  public append(keyword: Exclude<string, FITSCardInteger | FITSCardReal | FITSCardLogical | FITSCardString>, value: FITSCardValue, comment?: string | null): number
  public append(keyword: string, value: FITSCardValue, comment: string | null = null): number {
    return this.insertAt(this.#getMutableEntryCount(), keyword, value, comment)
  }

  /**
   * Inserts a new card at the specified user-defined header position.
   *
   * Mandatory FITS cards remain pinned at the top of the header.
   */
  public insertAt(index: number, keyword: FITSCardInteger | FITSCardReal, value: number, comment?: string | null): number
  public insertAt(index: number, keyword: FITSCardLogical, value: boolean, comment?: string | null): number
  public insertAt(index: number, keyword: FITSCardString, value: string, comment?: string | null): number
  public insertAt(index: number, keyword: Exclude<string, FITSCardInteger | FITSCardReal | FITSCardLogical | FITSCardString>, value: FITSCardValue, comment?: string | null): number
  public insertAt(index: number, keyword: string, value: FITSCardValue, comment: string | null = null): number {
    keyword = keyword.trimEnd()
    this.#assertWritableValueKeyword(keyword)

    const cardIndex = this.#getMutableInsertIndex(index)
    this.#cards.splice(cardIndex, 0, ...this.#getReplacementCards(keyword, value, comment))
    return Math.max(0, Math.min(index, this.#getMutableEntryCount() - 1))
  }

  /**
   * Inserts a new card at the end of the header (excluding END card).
   */
  public insert(keyword: FITSCardInteger | FITSCardReal, value: number, comment?: string | null): number
  public insert(keyword: FITSCardLogical, value: boolean, comment?: string | null): number
  public insert(keyword: FITSCardString, value: string, comment?: string | null): number
  public insert(keyword: Exclude<string, FITSCardInteger | FITSCardReal | FITSCardLogical | FITSCardString>, value: FITSCardValue, comment?: string | null): number
  public insert(keyword: string, value: FITSCardValue, comment: string | null = null): number {
    return this.append(keyword, value, comment)
  }

  /**
   * Removes the i-th card matching specified header keyword.
   */
  public remove(keyword: string, index: number = 0): boolean {
    keyword = keyword.trimEnd()
    this.#assertRemovableKeyword(keyword)

    const blocks = this.#getCardBlocks(keyword)
    if (blocks.length <= index) {
      return false
    }

    const { cardIndex, length } = blocks[index]!
    this.#cards.splice(cardIndex, length)
    return true
  }

  /**
   * Appends a blank keyword record, optionally containing a comment-only separator text.
   */
  public appendBlank(comment: string | null = null): number {
    return this.#insertCommentaryAt(this.#getMutableEntryCount(), "", comment)
  }

  /**
   * Appends a COMMENT card.
   */
  public appendComment(text: string): number {
    return this.#insertCommentaryAt(this.#getMutableEntryCount(), "COMMENT", text)
  }

  /**
   * Appends a HISTORY card.
   */
  public appendHistory(text: string): number {
    return this.#insertCommentaryAt(this.#getMutableEntryCount(), "HISTORY", text)
  }

  /**
   * Adds convenience WCS-like axis metadata for the specified axis number.
   */
  public addAxis(n: number, axis: FITSHeaderAxisOptions): void {
    if (!Number.isInteger(n) || n <= 0) {
      throw new RangeError(`Expected a positive axis number, but got ${n}`)
    }

    if (axis.ctype !== undefined) {
      this.set(`CTYPE${n}`, axis.ctype)
    }
    if (axis.cunit !== undefined) {
      this.set(`CUNIT${n}`, axis.cunit)
    }
    if (axis.crpix !== undefined) {
      this.set(`CRPIX${n}`, axis.crpix)
    }
    if (axis.crval !== undefined) {
      this.set(`CRVAL${n}`, axis.crval)
    }
    if (axis.cdelt !== undefined) {
      this.set(`CDELT${n}`, axis.cdelt)
    }
    if (axis.crota !== undefined) {
      this.set(`CROTA${n}`, axis.crota)
    }
  }

  /**
   * Creates a new FITS header overwriting the data type and axes length.
   *
   * @param {FITSBITPIX} BITPIX The number of bits per data value.
   * @param {number[]} axes The number of elements along each axis.
   * @returns {FITSHeader} The FITS header.
   */
  public copyWith(BITPIX: FITSBITPIX, axes: number[]): FITSHeader {
    if (BITPIX !== 8 && BITPIX !== 16 && BITPIX !== 32 && BITPIX !== 64 && BITPIX !== -32 && BITPIX !== -64) {
      throw new TypeError(`Unexpected BITPIX value: ${BITPIX}`)
    }
    for (let i = 0; i < axes.length; i++) {
      const value = axes[i]
      if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
        throw new TypeError(`Unexpected NAXIS${i + 1} value: ${value}`)
      }
    }

    const cards = [
      Card.fromValue("SIMPLE", true, "Fits standard"),
      Card.fromValue("BITPIX", BITPIX, "Bits per pixel"),
      Card.fromValue("NAXIS", axes.length, "Number of axes"),
      ...axes.map((value, i) => Card.fromValue(`NAXIS${i + 1}`, value, "Axis length")),
    ]

    for (const card of this.#cards) {
      if (card.keyword !== "SIMPLE" && card.keyword !== "BITPIX" && !card.keyword.startsWith("NAXIS")) {
        cards.push(structuredClone(card))
      }
    }

    return new FITSHeader(cards)
  }

  /**
   * Returns the FITS header as a JSON-serializable object.
   */
  public toJSON(): unknown {
    const map = new Map<string, FITSCardValue[]>()
    for (const card of this.#cards) {
      const value = card.isCommentary ? card.comment : card.value
      if (!map.has(card.keyword)) {
        map.set(card.keyword, [value])
      }
      else {
        map.get(card.keyword)!.push(value)
      }
    }
    return Object.fromEntries(map)
  }

  /**
   * Prints the FITS header to the console, adding `\n` between cards.
   */
  public prettyPrint(): void {
    for (const card of this.#cards) {
      console.log(card.image)
    }
  }

  /**
   * Converts the FITS header to an ArrayBuffer.
   */
  public toBuffer(): ArrayBuffer {
    const length = Math.ceil((this.#cards.length + 1) * Card.LENGTH / BLOCK_SIZE) * BLOCK_SIZE // +1 for END card

    const ascii = new TextEncoder()
    const buffer = new ArrayBuffer(length)
    const view = new DataView(buffer)
    let offset = 0

    for (let i = 0; i < this.#cards.length; i++) {
      const card = this.#cards[i]
      const record = card.image
      const recordBuffer = ascii.encode(record)
      for (let j = 0; j < recordBuffer.byteLength; j++) {
        view.setUint8(offset++, recordBuffer[j])
      }
    }

    // Fill with spaces
    while (offset < length - Card.LENGTH) view.setUint8(offset++, 32)
    // Add END card
    const endBuffer = ascii.encode(Card.fromValue("END", null).image)
    for (let i = 0; i < endBuffer.byteLength; i++) {
      view.setUint8(offset++, endBuffer[i])
    }

    return buffer
  }

  /**
   * Parses a FITS file to get its header.
   *
   * @param {ArrayBuffer} file The FITS file to parse.
   * @returns {FITSHeaderParsedResult} The FITS header and the number of bytes read.
   * @throws {Error} If the file is not a valid FITS file.
   */
  static fromBuffer(file: ArrayBuffer): FITSHeaderParsedResult {
    const ascii = new TextDecoder("ascii")
    const cards: Card[] = []

    let offset = 0
    for (;; offset += Card.LENGTH) {
      // Validate the record size
      const buffer = file.slice(offset, offset + Card.LENGTH)
      if (buffer.byteLength < Card.LENGTH) {
        throw new Error("Unexpected end of file")
      }

      // Parse the record
      const record = ascii.decode(buffer)
      const card = Card.fromImage(record)

      if (card.keyword === "END") {
        break
      }
      cards.push(card)
    }

    // Trim blanks
    while (cards.at(-1)?.isBlank) {
      cards.pop()
    }

    const header = new FITSHeader(cards)

    // Validate mandatory headers
    const SIMPLE = header.getValues("SIMPLE")
    if (SIMPLE.length !== 1) {
      throw new Error("Missing SIMPLE header")
    }
    else if (SIMPLE[0] !== true) {
      throw new TypeError(`Unexpected SIMPLE value: ${SIMPLE[0]}`)
    }

    const BITPIX = header.getValues("BITPIX")
    if (BITPIX.length !== 1) {
      throw new Error("Missing BITPIX header")
    }
    else if (BITPIX[0] !== 8 && BITPIX[0] !== 16 && BITPIX[0] !== 32 && BITPIX[0] !== 64 && BITPIX[0] !== -32 && BITPIX[0] !== -64) {
      throw new TypeError(`Unexpected BITPIX value: ${BITPIX[0]}`)
    }

    const NAXIS = header.getValues("NAXIS")
    if (NAXIS.length !== 1) {
      throw new Error("Missing NAXIS header")
    }
    else if (typeof NAXIS[0] !== "number" || !Number.isInteger(NAXIS[0]) || NAXIS[0] < 0 || NAXIS[0] > 999) {
      throw new TypeError(`Unexpected NAXIS value: ${NAXIS[0]}`)
    }

    for (let i = 1; i <= NAXIS[0]; i++) {
      const values = header.getValues(`NAXIS${i}`)
      if (values.length !== 1) {
        throw new RangeError(`Missing NAXIS${i} header`)
      }
      else if (typeof values[0] !== "number" || !Number.isInteger(values[0]) || values[0] <= 0) {
        throw new TypeError(`Unexpected NAXIS${i} value: ${values[0]}`)
      }
    }

    const EXTEND = header.getValues("EXTEND")
    if (EXTEND.length > 1) {
      throw new Error("Too many EXTEND headers")
    }
    else if (EXTEND[0] === true) {
      throw new Error(`Extended FITS files are not supported`)
    }

    return { header, bytesRead: offset }
  }

  /**
   * Creates a new FITS header. It will contain the mandatory headers SIMPLE, BITPIX, and NAXIS.
   *
   * @param {FITSBITPIX} BITPIX The number of bits per data value.
   * @param {number[]} axes The number of elements along each axis.
   * @returns {FITSHeader} The FITS header.
   */
  static basic(BITPIX: FITSBITPIX, axes: number[]): FITSHeader {
    return new FITSHeader([]).copyWith(BITPIX, axes)
  }
}
