import { describe, expect, it } from "vitest"

import { Card } from "../src/card"

describe("card.buildString - single-card string+comment cases", () => {
  it("creates a simple string card without comment and pads short strings to length 8", () => {
    const [card] = Card.buildString("KEY", "ABC")
    expect(card.keyword).toBe("KEY")
    expect(card.value).toBe("ABC")
    expect(card.comment).toBeNull()
    expect(card.image.length).toBe(Card.LENGTH)
    expect(card.image).toMatchInlineSnapshot(`"KEY     = 'ABC     '                                                            "`)

    // Short strings are padded to length 8 for backwards compatibility and wrapped in quotes.
    // So we expect to find the padded quoted representation `'ABC     '` in the image.
    expect(card.image.includes("'ABC     '")).toBe(true)

    // The image should be parseable back into the same card.
    const parsed = Card.fromImage(card.image)
    expect(parsed.keyword).toBe(card.keyword)
    expect(parsed.value).toBe(card.value)
    expect(parsed.comment).toBe(card.comment)
  })

  it("creates a string card with a comment that is placed at byte 30 (fixed-value format)", () => {
    const comment = "a short comment"
    const [card] = Card.buildString("SHORT", "XYZ", comment)
    expect(card.keyword).toBe("SHORT")
    expect(card.value).toBe("XYZ")
    expect(card.comment).toBe(comment)
    expect(card.image.length).toBe(Card.LENGTH)
    expect(card.image).toMatchInlineSnapshot(`"SHORT   = 'XYZ     '           / a short comment                                "`)

    // In the fixed-value format the comment separator " / " should start at byte 30 (0-based index 30).
    // FIXED_VALUE_LENGTH is 30, so the separator must be at index 30.
    expect(card.image.indexOf(" / ")).toBe(30)

    // Round-trip via fromImage should preserve everything.
    const parsed = Card.fromImage(card.image)
    expect(parsed.keyword).toBe(card.keyword)
    expect(parsed.value).toBe(card.value)
    expect(parsed.comment).toBe(card.comment)
  })

  it("creates a string card with a comment so long it doesn't pad the string", () => {
    const comment = "C".repeat(60)
    const [card] = Card.buildString("SHORT", "XYZ", comment)
    expect(card.keyword).toBe("SHORT")
    expect(card.value).toBe("XYZ")
    expect(card.comment).toBe(comment)
    expect(card.image.length).toBe(Card.LENGTH)
    expect(card.image).toMatchInlineSnapshot(`"SHORT   = 'XYZ' / CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC  "`)

    // In the fixed-value format the comment separator " / " should start at byte 30 (0-based index 30).
    // FIXED_VALUE_LENGTH is 30, so the separator must be at index 30.
    expect(card.image.indexOf(" / ")).toBe(30)

    // Round-trip via fromImage should preserve everything.
    const parsed = Card.fromImage(card.image)
    expect(parsed.keyword).toBe(card.keyword)
    expect(parsed.value).toBe(card.value)
    expect(parsed.comment).toBe(card.comment)
  })

  it("creates a string card for values longer than 8 characters (no 8-char padding) without comment", () => {
    // Value length > 8 so it should not be padded to 8 characters.
    const longValue = "NINECHAR9" // 9 chars
    const [card] = Card.buildString("LONGKEY", longValue)
    expect(card.keyword).toBe("LONGKEY")
    expect(card.value).toBe(longValue)
    expect(card.comment).toBeNull()
    expect(card.image.length).toBe(Card.LENGTH)
    expect(card.image).toMatchInlineSnapshot(`"LONGKEY = 'NINECHAR9'                                                           "`)

    // The image should contain the quoted value without 8-char padding.
    expect(card.image.includes(`'${longValue}'`)).toBe(true)

    const parsed = Card.fromImage(card.image)
    expect(parsed.keyword).toBe(card.keyword)
    expect(parsed.value).toBe(card.value)
    expect(parsed.comment).toBe(card.comment)
  })

  it("creates a very long string that still fits in a single card", () => {
    // LENGTH_AVAILABLE in fromString is 68 for the raw unquoted string length.
    const veryLong = "A".repeat(68)
    const [card] = Card.buildString("BIGVAL", veryLong)
    expect(card.keyword).toBe("BIGVAL")
    expect(card.value).toBe(veryLong)
    expect(card.comment).toBeNull()
    expect(card.image.length).toBe(Card.LENGTH)
    expect(card.image).toMatchInlineSnapshot(`"BIGVAL  = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'"`)

    const parsed = Card.fromImage(card.image)
    expect(parsed.keyword).toBe(card.keyword)
    expect(parsed.value).toBe(card.value)
    expect(parsed.comment).toBe(card.comment)
  })
})

describe("card.buildString (FITS string cards)", () => {
  describe("input validation", () => {
    it("throws TypeError for invalid keywords", () => {
      expect(() => Card.buildString("bad", "abc")).toThrow(TypeError)
      expect(() => Card.buildString("TOO LONG KEYWORD", "abc")).toThrow(TypeError)
      expect(() => Card.buildString("HAS SPACE", "abc")).toThrow(TypeError)
    })

    it("throws TypeError for commentary / forbidden keywords", () => {
      expect(() => Card.buildString("COMMENT", "abc")).toThrow(TypeError)
      expect(() => Card.buildString("HISTORY", "abc")).toThrow(TypeError)
      expect(() => Card.buildString("CONTINUE", "abc")).toThrow(TypeError)
      expect(() => Card.buildString("END", "abc")).toThrow(TypeError)
    })

    it("throws TypeError for non-ASCII values and comments", () => {
      expect(() => Card.buildString("OBJECT", "café")).toThrow(TypeError) // non-ascii
      expect(() => Card.buildString("OBJECT", "line\nbreak")).toThrow(TypeError) // control char
      expect(() => Card.buildString("OBJECT", "abc", "emoji 🚀")).toThrow(TypeError)
    })

    it("trims keyword trailing spaces", () => {
      const [card] = Card.buildString("OBJECT   ", "M42")
      const parsed = Card.fromImage(card.image)
      expect(parsed.keyword).toBe("OBJECT")
    })

    it("trims comment and converts blank comment to null-ish behavior", () => {
      const [c1] = Card.buildString("OBJECT", "M42", "  hello world  ")
      expect((c1 as any).comment ?? Card.fromImage(c1.image).comment).toBe("hello world")

      const [c2] = Card.buildString("OBJECT", "M42", "   ")
      const p2 = Card.fromImage(c2.image)
      expect(p2.comment).toBeNull()
      expect(p2.image.lastIndexOf("/")).toBe(-1)
    })
  })

  describe("single-record string keyword cards", () => {
    it("emits an 80-character restricted-ASCII card image", () => {
      const [card] = Card.buildString("OBJECT", "M42")
      expectFitsBasics(getImage(card))
    })

    it("uses fixed-format quoting (opening quote at byte 11) and value indicator '= '", () => {
      const [card] = Card.buildString("OBJECT", "M42")

      expect(card.image.startsWith("OBJECT  = ")).toBe(true)

      // fixed-format opening quote at byte 11 => index 10
      expect(card.image.indexOf("'")).toBe(10)
      expect(card.image.lastIndexOf("'")).toBeGreaterThanOrEqual(11)
      expect(card.image.lastIndexOf("'")).toBeLessThanOrEqual(79)
    })

    it("escapes embedded single quotes by doubling them", () => {
      const [card] = Card.buildString("AUTHOR", "O'HARA")
      const parsed = Card.fromImage(card.image)

      // In the image it must appear as O''HARA
      expect(parsed.value).toBe("O'HARA")
    })

    it("keeps the null-string vs empty-string distinction in the serialized image", () => {
      // FITS: '' is a null/zero-length string; ' ' is an empty string. (They are not the same.):contentReference[oaicite:10]{index=10}

      const [nullCard] = Card.buildString("KEYWORD1", "")
      const nullParsed = Card.fromImage(nullCard.image)
      expect(nullParsed.value).toBe("") // between quotes is empty

      const [emptyCard] = Card.buildString("KEYWORD2", " ")
      const emptyParsed = Card.fromImage(emptyCard.image)

      // Must contain at least one space between quotes to represent an empty string.
      // (Your implementation may pad beyond 1 space; that's OK.)
      expect(emptyParsed.value).toBeTypeOf("string")
      if (typeof emptyParsed.value === "string") {
        expect(emptyParsed.value.length).toBeGreaterThanOrEqual(1)
        expect(emptyParsed.value.trimEnd()).toBe("") // all spaces
      }
    })

    it("adds comments after '/' and (recommended) space before slash", () => {
      const [card] = Card.buildString("OBJECT", "M42", "Nebula")
      const img = getImage(card)
      const parsed = parseCardImage(img)

      expect(parsed.comment).toBe("Nebula")
      expect(parsed.slashIndex).toBeGreaterThan(-1)

      // recommended: a space before slash
      expect(img[parsed.slashIndex - 1]).toBe(" ")
    })

    it("fits exactly 68 characters inside quotes when value length is 68 (boundary case)", () => {
      const v = "A".repeat(68)
      const [card] = Card.buildString("BOUNDARY", v)
      const parsed = Card.fromImage(card.image)
      expect(parsed.rawValue.length).toBe(68)
      // closing quote should land at byte 80 (index 79) in fixed-format case
      expect(parsed.closeQuoteIndex).toBe(79)
    })
  })

  describe("continued string (long-string) keyword cards", () => {
    it("uses CONTINUE records with blanks in bytes 9-10 and '&' on all but the last substring", () => {
      const longValue = "A".repeat(150)
      const cards = Card.buildString("WEATHER", longValue) // WEATHER used as in FITS examples

      expect(cards.length).toBeGreaterThan(1)

      const images = cards.map(getImage)
      images.forEach(expectFitsBasics)

      const first = parseCardImage(images[0])
      expect(first.keyword).toBe("WEATHER")
      expect(first.indicator).toBe(VALUE_INDICATOR)
      expect(first.openQuoteIndex).toBe(10)

      for (let i = 1; i < images.length; i++) {
        const p = parseCardImage(images[i])
        expect(p.keyword).toBe("CONTINUE")
        expect(p.indicator).toBe("  ") // bytes 9-10 must be spaces for CONTINUE
        expect(p.openQuoteIndex).toBe(10)
      }

      // substring rules: <= 68 chars between quotes, '&' on all but last
      for (let i = 0; i < images.length; i++) {
        const p = parseCardImage(images[i])
        expect(p.rawValue.length).toBeLessThanOrEqual(68)

        const trimmed = p.rawValue.replace(/\s+$/, "")
        if (i < images.length - 1) expect(trimmed.endsWith("&")).toBe(true)
        else expect(trimmed.endsWith("&")).toBe(false)
      }

      // reconstruction must equal the escaped original (no quotes in this one)
      const reconstructed = reconstructContinuedString(images)
      expect(reconstructed).toBe(escapeFitsExpected(longValue))
    })

    it("can continue the comment field by using additional continuation records (value becomes empty continuations)", () => {
      const value = "abc"
      const comment
        = "This comment is intentionally long so it cannot fit on a single card and must be continued "
          + "across multiple CONTINUE records while preserving whole words."

      const cards = Card.buildString("WEATHER", value, comment)
      expect(cards.length).toBeGreaterThan(1)

      const images = cards.map(getImage)
      images.forEach(expectFitsBasics)

      // Reconstruct continued value: should match escaped original
      const reconstructedValue = reconstructContinuedString(images)
      expect(reconstructedValue).toBe(escapeFitsExpected(value))

      // Reconstruct comment words (normalized spaces) should match
      expect(reconstructComments(cards)).toBe(comment.trim().replace(/\s+/g, " "))
    })

    it("throws if the comment cannot be split into valid CONTINUE cards (e.g., single overlong word)", () => {
      const value = "abc"
      const impossibleComment = "X".repeat(200) // one huge word, no spaces to split on

      expect(() => Card.buildString("WEATHER", value, impossibleComment)).toThrow(Error)
    })

    it.todo(
      "sTRICT FITS: should reject CONTINUE usage for reserved/mandatory keywords unless declared long-string (e.g., DATE, XTENSION).",
    )

    it.todo(
      "should support long-string values that contain embedded quotes without hanging (requires guarding against empty substrings when avoiding split inside escaped quote pairs).",
    )
  })
})
