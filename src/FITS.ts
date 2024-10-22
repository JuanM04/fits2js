import type { FITSBITPIX, FITSHeaderInteger, FITSHeaderLogical, FITSHeaderReal, FITSHeaderString, FITSHeaderValue } from "./standard.js"
import * as Σ from "@nrsk/sigma"
import { type FITSHeaderRecord, KeywordRecordParser } from "./parser.js"
import { BLOCK_SIZE, isFITSHeaderInteger, isFITSHeaderLogical, isFITSHeaderReal, isFITSHeaderString, KEYWORD_RECORD_SIZE } from "./standard.js"

interface FITSContructorOptions {
  BITPIX: FITSBITPIX
  NAXIS: number
  NAXISn: number[]
  records: FITSHeaderRecord[]
  header: Map<string, FITSHeaderValue>
  dataBuffer: ArrayBuffer
}

// Standard FITS header keywords

export class FITS {
  readonly #records: FITSHeaderRecord[]
  readonly #header: Map<string, FITSHeaderValue>
  readonly #dataBuffer: ArrayBuffer
  readonly #dataView: DataView

  /**
   * The SIMPLE keyword is required to be the first keyword in the primary header of all FITS files. The value field
   * shall contain a logical constant with the value T if the file conforms to the standard. This keyword is mandatory
   * for the primary header and is not permitted in extension headers. A value of F signifies that the file does not
   * conform to this standard.
   */
  public readonly SIMPLE = true

  /**
   * The value field shall contain an integer. The absolute value is used in computing the sizes of data structures. It
   * shall specify the number of bits that represent a data value.
   *
   * The following values are recognized:
   * - `8`: Character or unsigned binary integer
   * - `16`: 16-bit two’s complement binary integer
   * - `32`: 32-bit two’s complement binary integer
   * - `64`: 64-bit two’s complement binary integer
   * - `−32`: IEEE single-precision floating point
   * - `−64`: IEEE double-precision floating poin
   */
  public readonly BITPIX: FITSBITPIX

  /**
   * The value field shall contain a non-negative integer no greater than 999, representing the number of axes in the
   * associated data array. A value of zero signifies that no data follow the header in the HDU. In the context of FITS
   * 'TABLE' or 'BINTABLE' extensions, the value of NAXIS is always 2.
   */
  public readonly NAXIS: number

  /**
   * The value field of this indexed keyword shall contain a non-negative integer, representing the number of elements
   * along axis n of a data array. The NAXISn must be present for all values n = 1,...,NAXIS, and for no other values
   * of n. A value of zero for any of the NAXISn signifies that no data follow the header in the HDU. If NAXIS is equal
   * to 0, there should not be any NAXISn keywords.
   */
  public readonly NAXISn: number[]

  constructor(opts: FITSContructorOptions) {
    this.BITPIX = opts.BITPIX
    this.NAXIS = opts.NAXIS
    this.NAXISn = opts.NAXISn
    this.#records = opts.records
    this.#header = opts.header
    this.#dataBuffer = opts.dataBuffer
    this.#dataView = new DataView(this.#dataBuffer)
  }

  /**
   * Returns the value of the specified header keyword.
   *
   * @param {string} keyword The keyword to retrieve.
   * @returns {FITSHeaderValue} The value of the keyword, or `undefined` if the keyword is not present.
   */
  public getHeader(keyword: FITSHeaderInteger | FITSHeaderReal): number | undefined
  public getHeader(keyword: FITSHeaderLogical): boolean | undefined
  public getHeader(keyword: FITSHeaderString): string | undefined
  public getHeader(keyword: Exclude<string, FITSHeaderInteger | FITSHeaderReal | FITSHeaderLogical | FITSHeaderString>): FITSHeaderValue
  public getHeader(keyword: string): FITSHeaderValue {
    const value = this.#header.get(keyword)
    if (value === undefined) {
      return value
    }

    if (isFITSHeaderInteger(keyword)) {
      if (typeof value !== "number" || !Number.isInteger(value)) {
        throw new TypeError(`Expected ${keyword} to be an integer, but got ${value} [${typeof value}]`)
      }
      return value
    }
    else if (isFITSHeaderReal(keyword)) {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new TypeError(`Expected ${keyword} to be an real, but got ${value} [${typeof value}]`)
      }
      return value
    }
    else if (isFITSHeaderLogical(keyword)) {
      if (typeof value !== "boolean") {
        throw new TypeError(`Expected ${keyword} to be a logical, but got ${value} [${typeof value}]`)
      }
      return value
    }
    else if (isFITSHeaderString(keyword)) {
      if (typeof value !== "string") {
        throw new TypeError(`Expected ${keyword} to be a string, but got ${value} [${typeof value}]`)
      }
      return value
    }

    return value
  }

  /**
   * Reads the data point at the specified offset according to the BITPIX value.
   *
   * @param {number} offset The offset of the data point (in bytes, 0-based).
   * @returns {number} The value of the data point.
   */
  #readDataPoint(offset: number): number {
    switch (this.BITPIX) {
      case 8:
        return this.#dataView.getInt8(offset)
      case 16:
        return this.#dataView.getInt16(offset, false)
      case 32:
        return this.#dataView.getInt32(offset, false)
      case 64:
        throw new TypeError("64-bit integers are not supported")
      case -32:
        return this.#dataView.getFloat32(offset, false)
      case -64:
        return this.#dataView.getFloat64(offset, false)
      default:
        throw new TypeError(`Unexpected BITPIX value ${this.BITPIX}`)
    }
  }

  /**
   * Returns one of the data points in the FITS file. The coordinates are 1-based
   * and are specified in the order of the axes `(n1, n2, ..., naxis)`.
   *
   * @param {...number} coords The coordinates of the data point.
   * @returns {number} The value of the data point.
   * @throws {RangeError} If the coordinates are out of bounds.
   */
  public getDataPoint(...coords: number[]): number {
    if (coords.length !== this.NAXIS) {
      throw new RangeError(`Expected ${this.NAXIS} coordinates, but got ${coords.length}`)
    }
    if (this.NAXIS === 0) {
      throw new RangeError("NAXIS is 0, no data available")
    }

    let mul = 1
    let offset = 0
    for (let i = 0; i < this.NAXIS; i++) {
      offset += coords[i] * mul
      mul *= this.NAXISn[i]
    }
    offset *= Math.abs(this.BITPIX) / 8

    if (offset < 0 || offset >= this.#dataView.byteLength) {
      throw new RangeError(`Coordinates out of bounds: ${coords.join(", ")} (byte ${offset} out of ${this.#dataView.byteLength})`)
    }

    return this.#readDataPoint(offset)
  }

  /**
   * Returns all the data of the FITS file as a generator. The coordinates are 1-based and are specified in the order
   * of the axes `(n1, n2, ..., naxis)`.
   * @returns A generator that yields the coordinates and the value of each data point.
   */
  public *getData(): Generator<{ coordinates: number[], value: number }, void, unknown> {
    if (this.NAXIS === 0) {
      return
    }

    const coords = Array.from<number>({ length: this.NAXIS }).fill(1)
    let offset = 0
    const diff = Math.abs(this.BITPIX) / 8

    do {
      yield {
        coordinates: [...coords],
        value: this.#readDataPoint(offset),
      }
      offset += diff

      let i = 0
      coords[i]++
      while (coords[i] > this.NAXISn[i]) {
        coords[i] = 1
        coords[++i]++
      }
    } while (offset < this.#dataView.byteLength)
  }

  /**
   * Returns the FITS file as a JSON-serializable object.
   */
  public toJSON(): unknown {
    return {
      header: Object.fromEntries(this.#header),
      data: Array.from(this.getData()).map(({ value }) => value),
    }
  }

  /**
   * Parses a FITS file.
   *
   * @param {ArrayBuffer} file The FITS file to parse.
   * @param {number | null} forceNaxis The expected value of NAXIS. If specified, the parser will throw an error if the
   *                                   actual value does not match the expected value.
   * @returns {FITS} The header and data of the FITS file.
   * @throws {Error} If the file is not a valid FITS file.
   */
  static fromBuffer(file: ArrayBuffer, forceNaxis: number | null): FITS {
    const ascii = new TextDecoder("ascii")
    const header = new Map<string, FITSHeaderValue>()
    const records: FITSHeaderRecord[] = []

    let offset = 0
    for (;; offset += KEYWORD_RECORD_SIZE) {
      // Validate the record size
      const buffer = file.slice(offset, offset + KEYWORD_RECORD_SIZE)
      if (buffer.byteLength < KEYWORD_RECORD_SIZE) {
        throw new Error("Unexpected end of file")
      }

      // Parse the record
      const record = ascii.decode(buffer)
      const result = Σ.run(KeywordRecordParser).with(record)

      if (result.isOk) {
        records.push(result.value)
        const { name: keyword, value } = result.value

        if (keyword === "END") {
          break
        }

        if (keyword === "" || keyword === "COMMENT" || keyword === "HISTORY") {
          continue
        }

        if (keyword === "CONTINUE") {
          const previous = records.at(-1)
          const old = previous && header.get(previous.name)
          if (typeof old === "string" && old.at(-1) === "&") {
            header.set(previous!.name, old.slice(0, -1) + value)
          }
          continue
        }

        if (header.has(keyword)) {
          throw new Error(`Found repeated keyword: ${keyword}`)
        }

        header.set(keyword, value)
      }
      else {
        throw new Error(`Failed to parse keyword record: expected ${result.expected}, at ${offset + result.span[0]}`)
      }
    }

    // Validate mandatory headers
    const BITPIX = header.get("BITPIX")
    if (!BITPIX) {
      throw new Error("Missing BITPIX header")
    }
    else if (BITPIX !== 8 && BITPIX !== 16 && BITPIX !== 32 && BITPIX !== 64 && BITPIX !== -32 && BITPIX !== -64) {
      throw new TypeError(`Unexpected BITPIX value: ${BITPIX}`)
    }

    const NAXIS = header.get("NAXIS")
    if (!NAXIS) {
      throw new Error("Missing NAXIS header")
    }
    else if (typeof NAXIS !== "number" || !Number.isInteger(NAXIS) || NAXIS < 0 || NAXIS > 999) {
      throw new TypeError(`Unexpected NAXIS value: ${NAXIS}`)
    }

    if (typeof forceNaxis === "number" && NAXIS !== forceNaxis) {
      throw new Error(`Mismatched NAXIS value: expected ${forceNaxis}, but got ${NAXIS}`)
    }

    let expectedBytes = Math.abs(BITPIX) / 8
    for (let i = 1; i <= NAXIS; i++) {
      const value = header.get(`NAXIS${i}`)
      if (!value) {
        throw new RangeError(`Missing NAXIS${i} header`)
      }
      else if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
        throw new TypeError(`Unexpected NAXIS${i} value: ${value}`)
      }
      expectedBytes *= value
    }
    if (NAXIS === 0) {
      expectedBytes = 0
    }

    // Align the offset to the next block
    offset = Math.ceil(offset / BLOCK_SIZE) * BLOCK_SIZE
    const dataBuffer = file.slice(offset, offset + expectedBytes)
    if (dataBuffer.byteLength !== expectedBytes) {
      throw new RangeError(`Expected ${expectedBytes} bytes of data, but got ${dataBuffer.byteLength}`)
    }

    return new FITS({
      BITPIX,
      NAXIS,
      NAXISn: Array.from({ length: NAXIS }, (_, i) => header.get(`NAXIS${i + 1}`) as number),
      records,
      header,
      dataBuffer,
    })
  }
}
