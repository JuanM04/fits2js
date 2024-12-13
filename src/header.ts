import type { FITSBITPIX } from "./data.js"
import { Card, type FITSCardValue } from "./card.js"

interface FITSHeaderParsedResult {
  header: FITSHeader
  bytesRead: number
}

// Card types

export type FITSCardInteger =
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
const fitsCardIntegerRegExp = /^BITPIX|BLANK|EXTLEVEL|EXTVER|GCOUNT|NAXIS\d{0,3}|PCOUNT|TBCOL\d{1,3}|TFIELDS|THEAP$/g
export function isFITSCardInteger(keyword: string): keyword is FITSCardInteger {
  return fitsCardIntegerRegExp.test(keyword)
}

export type FITSCardReal =
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
const fitsCardRealRegExp = /^BSCALE|BZERO|CDELT\d{1,3}|CROTA\d{1,3}|CRPIX\d{1,3}|CRVAL\d{1,3}|DATAMAX|DATAMIN|EPOCH|EQUINOX|PSCAL\d{1,3}|PZERO\d{1,3}|TSCAL\d{1,3}|TZERO\d{1,3}$/g
export function isFITSCardReal(keyword: string): keyword is FITSCardReal {
  return fitsCardRealRegExp.test(keyword)
}

export type FITSCardString =
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
const fitsCardStringRegExp = /^AUTHOR|BUNIT|CTYPE\d{1,3}|DATE\S{0,4}|EXTNAME|INSTRUME|OBJECT|OBSERVER|ORIGIN|PTYPE\d{1,3}|REFERENC|TDIM\d{1,3}|TDISP\d{1,3}|TELESCOP|TFORM\d{1,3}|TTYPE\d{1,3}|TUNIT\d{1,3}|XTENSION$/g
export function isFITSCardString(keyword: string): keyword is FITSCardString {
  return fitsCardStringRegExp.test(keyword)
}

export type FITSCardLogical =
  | "BLOCKED"
  | "EXTEND"
  | "GROUPS"
  | "SIMPLE"
const fitsCardLogicalRegExp = /^BLOCKED|EXTEND|GROUPS|SIMPLE$/g
export function isFITSCardLogical(keyword: string): keyword is FITSCardLogical {
  return fitsCardLogicalRegExp.test(keyword)
}

export class FITSHeader {
  readonly #cards: Card[] = []

  private constructor(cards: Card[]) {
    this.#cards = cards
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
    if (keyword === "CONTINUE" || keyword === "") {
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
        while (v.endsWith("&") && this.#cards.at(i + 1)?.keyword === "CONTINUE") {
          v = v.slice(0, -1) + this.#cards.at(i + 1)!.value
          i++
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
   * @returns {FITSCardValue} The value of the keyword, or `undefined` if the keyword is not present.
   */
  public getValue(keyword: FITSCardInteger | FITSCardReal): number | undefined
  public getValue(keyword: FITSCardLogical): boolean | undefined
  public getValue(keyword: FITSCardString): string | undefined
  public getValue(keyword: Exclude<string, FITSCardInteger | FITSCardReal | FITSCardLogical | FITSCardString>): FITSCardValue | undefined
  public getValue(keyword: string): FITSCardValue | undefined {
    return this.getValues(keyword).at(0)
  }

  /**
   * Sets the value of the i-th card matching specified header keyword. If the keyword is not present, it will be created.
   * If the value is `undefined`, the keyword will be removed.
   *
   * @param {string} keyword The keyword to set.
   * @param {FITSCardValue} value The value to set.
   * @param {number} [index=0] The index of the card to set. If the index is out of bounds, the value will be appended.
   * @returns {number} The index of the card that was set.
   */
  public setValue(keyword: FITSCardInteger | FITSCardReal, value: number | undefined, index: number): number
  public setValue(keyword: FITSCardLogical, value: boolean | undefined, index: number): number
  public setValue(keyword: FITSCardString, value: string | undefined, index: number): number
  public setValue(keyword: Exclude<string, FITSCardInteger | FITSCardReal | FITSCardLogical | FITSCardString>, value: FITSCardValue | undefined, index: number): number
  public setValue(keyword: string, value: FITSCardValue | undefined, index: number = 0): number {
    if (keyword === "SIMPLE" || keyword === "CONTINUE" || keyword === "BITPIX" || keyword.startsWith("NAXIS")) {
      throw new TypeError(`Cannot set value for "${keyword}" keyword`)
    }

    const cards = this.#cards.map((c, i) => [c, i] as const).filter(([card]) => card.keyword === keyword)
    if (cards.length >= index) {
      if (value !== undefined) {
        this.#cards.push(Card.fromValue(keyword, value))
        return this.#cards.length - 1
      }
      return -1 // No card to remove
    }

    let n = 1
    while (this.#cards.at(cards[index][1] + n)?.keyword === "CONTINUE") {
      n++
    }
    this.#cards.splice(cards[index][1], n)

    if (value !== undefined) {
      this.#cards.splice(cards[index][1], 0, Card.fromValue(keyword, value))
    }
    return index
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

  public toJSON(): unknown {
    const map = new Map<string, FITSCardValue[]>()
    for (const card of this.#cards) {
      if (!map.has(card.keyword)) {
        map.set(card.keyword, [card.value])
      }
      else {
        map.get(card.keyword)!.push(card.value)
      }
    }
    return Object.fromEntries(map)
  }

  /**
   * Converts the FITS header to an ArrayBuffer.
   */
  public toBuffer(): ArrayBuffer {
    const cards = [...this.#cards, Card.fromValue("END", null)]
    const ascii = new TextEncoder()
    const buffer = new ArrayBuffer(cards.length * Card.LENGTH)
    const view = new DataView(buffer)

    for (let i = 0; i < cards.length; i++) {
      const card = cards[i]
      const record = card.image
      const recordBuffer = ascii.encode(record)
      for (let j = 0; j < recordBuffer.byteLength; j++) {
        view.setUint8(i * Card.LENGTH + j, recordBuffer[j])
      }
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
      const card = Card.fromString(record)

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
