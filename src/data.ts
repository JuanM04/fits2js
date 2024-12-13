export type FITSBITPIX = 8 | 16 | 32 | 64 | -32 | -64

interface FITSDataContructorOptions {
  BITPIX: FITSBITPIX
  NAXIS: number
  NAXISn: number[]
  dataBuffer: ArrayBuffer
}

export class FITSData {
  readonly #dataBuffer: ArrayBuffer
  readonly #dataView: DataView

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

  constructor(opts: FITSDataContructorOptions) {
    this.BITPIX = opts.BITPIX
    this.NAXIS = opts.NAXIS
    this.NAXISn = opts.NAXISn
    this.#dataBuffer = opts.dataBuffer
    this.#dataView = new DataView(this.#dataBuffer)
  }

  /**
   * Reads the data point at the specified offset according to the BITPIX value.
   *
   * @param {number} offset The offset of the data point (in bytes, 0-based).
   * @returns {number} The value of the data point.
   */
  #readPoint(offset: number): number {
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
   * Returns one of the data points in HDU. The coordinates are 1-based
   * and are specified in the order of the axes `(n1, n2, ..., nNAXIS)`.
   *
   * @param {...number} coords The coordinates of the data point.
   * @returns {number} The value of the data point.
   * @throws {RangeError} If the coordinates are out of bounds.
   */
  public getPoint(...coords: number[]): number {
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

    return this.#readPoint(offset)
  }

  /**
   * Returns all the data of the HDU as a generator. The coordinates are 1-based and are specified in the order
   * of the axes `(n1, n2, ..., nNAXIS)`.
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
        value: this.#readPoint(offset),
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

  public toString(): string {
    return `${this.NAXISn.join("x")} matrix (BITPIX = ${this.BITPIX})`
  }

  public toJSON(): unknown {
    return Array.from(this.getData()).map(({ value }) => value)
  }

  public toBuffer(): ArrayBuffer {
    return structuredClone(this.#dataBuffer)
  }

  /**
   * Creates a new FITS data unit.
   *
   * **Warning**: This method does not check if BITPIX and NAXIS are valid, only checks the data.
   * It's intended to be called by {@link FITS}.
   *
   * @param {number[]} data The data of the FITS file.
   * @param {BITPIX} BITPIX The bits per pixel of the data.
   * @param {number[]} axes The axes of the data matrix.
   * @returns {FITSData} The data of the FITS file.
   */
  public static fromArray(data: number[], BITPIX: FITSBITPIX, axes: number[]): FITSData {
    const points = axes.reduce((accum, len) => accum * len, 1)
    if (data.length !== points) {
      throw new RangeError(`Expected ${points} data points, but got ${data.length}`)
    }

    const dataBuffer = new ArrayBuffer(points * Math.abs(BITPIX) / 8)
    const dataView = new DataView(dataBuffer)
    for (const point of data) {
      switch (BITPIX) {
        case 8:
          dataView.setInt8(dataView.byteLength, point)
          break
        case 16:
          dataView.setInt16(dataView.byteLength, point, false)
          break
        case 32:
          dataView.setInt32(dataView.byteLength, point, false)
          break
        case 64:
          throw new TypeError("64-bit integers are not supported")
        case -32:
          dataView.setFloat32(dataView.byteLength, point, false)
          break
        case -64:
          dataView.setFloat64(dataView.byteLength, point, false)
          break
        default:
          throw new TypeError(`Unexpected BITPIX value ${BITPIX}`)
      }
    }

    return new FITSData({ BITPIX, NAXIS: axes.length, NAXISn: axes, dataBuffer })
  }
}
