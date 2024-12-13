import { type FITSBITPIX, FITSData } from "./data.js"
import { FITSHeader } from "./header.js"

const BLOCK_SIZE = 2880

// Standard FITS header keywords

export class FITS {
  private constructor(
    readonly header: FITSHeader,
    readonly data: FITSData,
  ) {}

  /**
   * Returns the FITS file as a JSON-serializable object.
   */
  public toJSON(): unknown {
    return {
      header: this.header.toJSON(),
      data: this.data.toJSON(),
    }
  }

  /**
   * Returns the FITS file as a binary buffer.
   */
  public toBuffer(): ArrayBuffer {
    const headerBuffer = this.header.toBuffer()
    const dataBuffer = this.data.toBuffer()

    const headerLength = Math.ceil(headerBuffer.byteLength / BLOCK_SIZE) * BLOCK_SIZE
    const dataLength = Math.ceil(dataBuffer.byteLength / BLOCK_SIZE) * BLOCK_SIZE
    const totalLength = headerLength + dataLength

    const buffer = new ArrayBuffer(totalLength)
    const view = new DataView(buffer)

    const headerView = new DataView(headerBuffer)
    for (let i = 0; i < headerBuffer.byteLength; i++) {
      view.setUint8(i, headerView.getUint8(i))
    }
    for (let i = headerBuffer.byteLength; i < headerLength; i++) {
      view.setUint8(i, 32) // ASCII space
    }

    const dataView = new DataView(dataBuffer)
    for (let i = 0; i < dataBuffer.byteLength; i++) {
      view.setUint8(headerLength + i, dataView.getUint8(i))
    }
    for (let i = dataBuffer.byteLength; i < dataLength; i++) {
      view.setUint8(headerLength + i, 0)
    }

    return buffer
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
    const { header, bytesRead } = FITSHeader.fromBuffer(file)

    const BITPIX = header.getValue("BITPIX") as FITSBITPIX
    const NAXIS = header.getValue("NAXIS")!
    const NAXISn = Array.from({ length: NAXIS }, (_, i) => header.getValue(`NAXIS${i + 1}`)!)

    if (typeof forceNaxis === "number" && NAXIS !== forceNaxis) {
      throw new Error(`Mismatched NAXIS value: expected ${forceNaxis}, but got ${NAXIS}`)
    }

    const expectedBytes = NAXIS === 0
      ? 0
      : NAXISn.reduce((accum, len) => accum * len, Math.abs(BITPIX) / 8)

    // Align the offset to the next block
    const offset = Math.ceil(bytesRead / BLOCK_SIZE) * BLOCK_SIZE
    const dataBuffer = file.slice(offset, offset + expectedBytes)
    if (dataBuffer.byteLength !== expectedBytes) {
      throw new RangeError(`Expected ${expectedBytes} bytes of data, but got ${dataBuffer.byteLength}`)
    }

    const data = new FITSData({ BITPIX, NAXIS, NAXISn, dataBuffer })

    return new FITS(header, data)
  }

  /**
   * Creates a new FITS file.
   *
   * The data is expected to follow this matrix form: \
   * A(1, 1, ..., 1) \
   * A(2, 1, ..., 1) \
   * ... \
   * A(NAXIS1, 1, ..., 1) \
   * A(1, 2, ..., 1) \
   * ... \
   * A(1, NAXIS2, ..., 1) \
   * ... \
   * A(NAXIS1, NAXIS2, ..., NAXISm)
   *
   *
   * @param {number[]} points The points of the FITS file.
   * @param {BITPIX} BITPIX The bits per point of the data.
   * @param {number[]} axes The axes of the data matrix.
   * @param {FITSHeader} [copyHeader] The header to copy from.
   * @returns {FITS} The header and data of the FITS file.
   */
  static fromDataArray(points: number[], BITPIX: FITSBITPIX, axes: number[], copyHeader?: FITSHeader): FITS {
    const header = copyHeader ? copyHeader.copyWith(BITPIX, axes) : FITSHeader.basic(BITPIX, axes)
    const data = FITSData.fromArray(points, BITPIX, axes)

    return new FITS(header, data)
  }
}
