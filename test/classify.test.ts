import { describe, expect, it } from "bun:test"
import { DEFAULT_ROW_LIMIT, classifyAll, classifyFile, limitRows } from "../src/classify"

describe("classifyFile", () => {
  it("uses the authoritative status field", () => {
    expect(classifyFile({ file: "a.txt", additions: 3, deletions: 1, status: "modified" }).kind).toBe("modified")
    expect(classifyFile({ file: "a.txt", additions: 13, deletions: 0, status: "added" }).kind).toBe("added")
    expect(classifyFile({ file: "a.txt", additions: 0, deletions: 6, status: "deleted" }).kind).toBe("deleted")
  })

  it("falls back to the ±count heuristic when status is missing (docs §2.4)", () => {
    expect(classifyFile({ file: "new.ts", additions: 10, deletions: 0 }).kind).toBe("added")
    expect(classifyFile({ file: "gone.ts", additions: 0, deletions: 4 }).kind).toBe("deleted")
    expect(classifyFile({ file: "both.ts", additions: 7, deletions: 3 }).kind).toBe("modified")
  })

  it("treats 0/0 as binary regardless of status (matrix #5)", () => {
    expect(classifyFile({ file: "img.png", additions: 0, deletions: 0, status: "modified" }).kind).toBe("binary")
    expect(classifyFile({ file: "img.png", additions: 0, deletions: 0 }).kind).toBe("binary")
  })

  it("keeps file and counters untouched", () => {
    expect(classifyFile({ file: "x/y.swift", additions: 28, deletions: 9, status: "modified" })).toEqual({
      file: "x/y.swift",
      kind: "modified",
      additions: 28,
      deletions: 9,
    })
  })
})

describe("classifyAll", () => {
  it("sorts modified > added > deleted, additions desc inside a group (docs §4)", () => {
    const rows = classifyAll([
      { file: "d.txt", additions: 0, deletions: 5, status: "deleted" },
      { file: "a2.txt", additions: 3, deletions: 0, status: "added" },
      { file: "m2.txt", additions: 5, deletions: 5, status: "modified" },
      { file: "a1.txt", additions: 13, deletions: 0, status: "added" },
      { file: "m1.txt", additions: 110, deletions: 3, status: "modified" },
    ])
    expect(rows.map((row) => row.file)).toEqual(["m1.txt", "m2.txt", "a1.txt", "a2.txt", "d.txt"])
  })

  it("breaks count ties by path for stable output", () => {
    const rows = classifyAll([
      { file: "b.txt", additions: 2, deletions: 0, status: "added" },
      { file: "a.txt", additions: 2, deletions: 0, status: "added" },
    ])
    expect(rows.map((row) => row.file)).toEqual(["a.txt", "b.txt"])
  })

  it("returns [] for an empty session diff (matrix #1: section hidden)", () => {
    expect(classifyAll([])).toEqual([])
  })

  it("matches the docs §4 example ordering", () => {
    const rows = classifyAll([
      { file: "legacy/main.swift", additions: 0, deletions: 6, status: "deleted" },
      { file: "i18n/locales/en.json", additions: 13, deletions: 0, status: "added" },
      { file: "PicXure/Views/AnnotationOverlay.swift", additions: 110, deletions: 3, status: "modified" },
      { file: "PicXure/PicXureApp.swift", additions: 28, deletions: 9, status: "modified" },
    ])
    expect(rows.map((row) => row.file)).toEqual([
      "PicXure/Views/AnnotationOverlay.swift",
      "PicXure/PicXureApp.swift",
      "i18n/locales/en.json",
      "legacy/main.swift",
    ])
  })
})

describe("limitRows", () => {
  it("shows at most the default 8 rows and reports the remainder (matrix #7)", () => {
    const input = Array.from({ length: 10 }, (_, index) => ({
      file: `f${index}.txt`,
      additions: index + 1,
      deletions: 0,
      status: "added" as const,
    }))
    const { shown, hidden } = limitRows(classifyAll(input))
    expect(shown).toHaveLength(DEFAULT_ROW_LIMIT)
    expect(hidden).toBe(2)
    // Highest-additions files win the visible slots.
    expect(shown[0]?.file).toBe("f9.txt")
  })

  it("hides nothing below the limit", () => {
    const { shown, hidden } = limitRows(classifyAll([{ file: "a.txt", additions: 1, deletions: 0, status: "added" }]))
    expect(shown).toHaveLength(1)
    expect(hidden).toBe(0)
  })

  it("handles a non-positive limit", () => {
    const { shown, hidden } = limitRows(classifyAll([{ file: "a.txt", additions: 1, deletions: 0, status: "added" }]), 0)
    expect(shown).toHaveLength(0)
    expect(hidden).toBe(1)
  })
})
