import { readFile } from "node:fs/promises"
import { expect, it } from "vitest"

import { parseFITS } from ".."

it("test WCOMP01.fits", async () => {
  const file = await readFile(new URL("./WCOMP01.fits", import.meta.url))
  const result = parseFITS(file.buffer)
  expect(result).toMatchSnapshot()
})

it("test EFBTCOMP01.fits", async () => {
  const file = await readFile(new URL("./EFBTCOMP01.fits", import.meta.url))
  const result = parseFITS(file.buffer)
  expect(result).toMatchSnapshot()
})
