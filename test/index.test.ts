import { readFile } from "node:fs/promises"
import { expect, it } from "vitest"

import { FITS } from "../src"

it("test WCOMP01.fits", async () => {
  const file = await readFile(new URL("./WCOMP01.fits", import.meta.url))
  const result = FITS.fromBuffer(file.buffer, null)
  expect(result).toMatchSnapshot()
})

it("test WOBJ01.fits", async () => {
  const file = await readFile(new URL("./WOBJ01.fits", import.meta.url))
  const result = FITS.fromBuffer(file.buffer, null)
  expect(result).toMatchSnapshot()
})

it("test EFBTCOMP01.fits", async () => {
  const file = await readFile(new URL("./EFBTCOMP01.fits", import.meta.url))
  const result = FITS.fromBuffer(file.buffer, null)
  expect(result).toMatchSnapshot()
})
