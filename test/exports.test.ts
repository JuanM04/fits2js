import { readFile } from "node:fs/promises"
import { dirname } from "node:path"
import { describe, expect, it } from "vitest"
import { getPackageExportsManifest } from "vitest-package-exports"
import yaml from "yaml"

describe("exports-snapshot", async () => {
  const packageUrl = new URL("../package.json", import.meta.url)
  const packageJson: { name: string, private?: boolean } = JSON.parse(
    await readFile(packageUrl, "utf8"),
  )
  const packages = [{
    name: packageJson.name,
    path: dirname(packageUrl.pathname),
    private: packageJson.private,
  }]

  for (const pkg of packages) {
    if (pkg.private)
      continue
    it(`${pkg.name}`, async () => {
      const manifest = await getPackageExportsManifest({
        importMode: "src",
        cwd: pkg.path,
      })
      await expect(yaml.stringify(manifest.exports))
        .toMatchFileSnapshot(`./exports/${pkg.name}.yaml`)
    })
  }
})
