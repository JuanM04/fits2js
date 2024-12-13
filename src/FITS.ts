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
}
