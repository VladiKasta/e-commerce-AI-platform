import { describe, expect, it } from "vitest"
import { formatPrice } from "~/utils/format-price"

describe("formatPrice", () => {
  it("форматирует целую сумму в основных единицах (1490 = 1490 ₽, без деления на 100)", () => {
    const text = formatPrice(1490, "rub", "ru-RU")

    expect(text).toContain("1")
    expect(text).toContain("490")
    expect(text).toContain("₽")
    // Явная защита от деления на 100.
    expect(text).not.toContain("14,9")
    expect(text).not.toContain("14.9")
  })

  it("принимает суммы-строки (BigNumber Medusa)", () => {
    expect(formatPrice("1490", "rub", "ru-RU")).toBe(formatPrice(1490, "rub", "ru-RU"))
  })

  it("показывает дробную часть для нецелых сумм", () => {
    const text = formatPrice(1490.5, "rub", "ru-RU")
    expect(text).toContain("50")
  })

  it("поддерживает другую валюту и локаль", () => {
    const text = formatPrice(10, "usd", "en-US")
    expect(text).toContain("$")
  })

  it("возвращает заглушку для отсутствующей суммы", () => {
    expect(formatPrice(null, "rub", "ru-RU")).toBe("Цена не указана")
    expect(formatPrice(undefined, "rub", "ru-RU")).toBe("Цена не указана")
    expect(formatPrice("", "rub", "ru-RU")).toBe("Цена не указана")
    expect(formatPrice("not-a-number", "rub", "ru-RU")).toBe("Цена не указана")
  })
})
