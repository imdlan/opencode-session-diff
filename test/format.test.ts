import { describe, expect, it } from "bun:test"
import { SIDEBAR_WIDTH, formatCounts, layoutRow, truncatePath, visibleWidth } from "../src/format"

describe("visibleWidth", () => {
  it("counts ASCII as single width", () => {
    expect(visibleWidth("abc")).toBe(3)
    expect(visibleWidth("")).toBe(0)
  })

  it("counts fullwidth icons as double width", () => {
    expect(visibleWidth("＋")).toBe(2) // U+FF0B added
    expect(visibleWidth("－")).toBe(2) // U+FF0D deleted
    expect(visibleWidth("✎")).toBe(1) // modified
    expect(visibleWidth("●")).toBe(1) // binary
  })
})

describe("formatCounts", () => {
  it("formats both counters", () => {
    expect(formatCounts(28, 9)).toBe("+28 −9")
  })

  it("omits zero counters", () => {
    expect(formatCounts(13, 0)).toBe("+13")
    expect(formatCounts(0, 6)).toBe("−6")
  })

  it("returns an empty string for binary 0/0", () => {
    expect(formatCounts(0, 0)).toBe("")
  })

  it("uses U+2212 MINUS SIGN", () => {
    expect(formatCounts(0, 1).codePointAt(0)).toBe(0x2212)
  })
})

describe("truncatePath", () => {
  it("keeps short paths untouched", () => {
    expect(truncatePath("Views/AnnotationOverlay.swift", 31)).toBe("Views/AnnotationOverlay.swift")
  })

  it("cuts directory segments first and keeps the basename intact (matrix #6)", () => {
    expect(truncatePath("PicXure/Views/AnnotationOverlay.swift", 29)).toBe("Views/AnnotationOverlay.swift")
    expect(truncatePath("PicXure/Views/AnnotationOverlay.swift", 28)).toBe("AnnotationOverlay.swift")
  })

  it("falls back to the bare basename when no directory segment fits", () => {
    expect(truncatePath("a/b/verylongbasename.swift", 22)).toBe("verylongbasename.swift")
  })

  it("tail-clips behind an ellipsis when the basename alone overflows", () => {
    const out = truncatePath("an-extremely-long-basename.swift", 15)
    expect(visibleWidth(out)).toBe(15)
    expect(out.startsWith("…")).toBe(true)
    expect(out.endsWith(".swift")).toBe(true)
  })

  it("never exceeds the budget for deep trees", () => {
    const out = truncatePath("deep/dir/tree/with/many/segments/file.name.ts", 20)
    expect(visibleWidth(out)).toBeLessThanOrEqual(20)
  })

  it("handles degenerate budgets", () => {
    expect(truncatePath("anything", 0)).toBe("")
    expect(truncatePath("ab", 1)).toBe("…")
  })
})

describe("layoutRow", () => {
  it("right-aligns counters to exactly the sidebar width (docs §4 example)", () => {
    const row = layoutRow("•", "PicXure/PicXureApp.swift", "+28 −9")
    expect(row.path).toBe("PicXure/PicXureApp.swift")
    expect(visibleWidth("•") + 1 + visibleWidth(row.path) + row.gap + visibleWidth("+28 −9")).toBe(SIDEBAR_WIDTH)
    expect(row.gap).toBe(10)
  })

  it("reproduces the docs §4 second row", () => {
    const row = layoutRow("•", "PicXure/Views/AnnotationOverlay.swift", "+110 −3")
    expect(row.path).toBe("Views/AnnotationOverlay.swift")
    expect(row.gap).toBe(4)
  })

  it("accounts for every icon width", () => {
    const row = layoutRow("•", "i18n/locales/en.json", "+13")
    expect(visibleWidth("•") + 1 + visibleWidth(row.path) + row.gap + visibleWidth("+13")).toBe(SIDEBAR_WIDTH)
    expect(row.gap).toBe(17)
  })

  it("truncates over-long paths to fit long counters", () => {
    const counts = "+1100 −300"
    const row = layoutRow("•", "PicXure/Views/AnnotationOverlay.swift", counts)
    expect(visibleWidth(row.path) + row.gap).toBe(SIDEBAR_WIDTH - 2 - visibleWidth(counts))
  })

  it("drops the gap when there are no counters (binary rows)", () => {
    const row = layoutRow("•", "assets/logo.png", "")
    expect(row.gap).toBe(0)
    expect(row.path).toBe("assets/logo.png")
  })
})
