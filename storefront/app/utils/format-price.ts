import type { CommerceMoneyAmount } from "#shared/types/commerce"

/**
 * Форматирует сумму Medusa в валюту через Intl.NumberFormat.
 *
 * Medusa хранит суммы в основных единицах: 1490 = 1490 ₽.
 * Деление/умножение на 100 не выполняется — формат проверен
 * на реальных ответах Store API (Medusa 2.23).
 */
export function formatPrice(
  amount: CommerceMoneyAmount | null | undefined,
  currency: string,
  locale: string
): string {
  if (amount === null || amount === undefined || amount === "") {
    return "Цена не указана"
  }

  const value =
    typeof amount === "string" ? Number.parseFloat(amount) : amount

  if (!Number.isFinite(value)) {
    return "Цена не указана"
  }

  // Для целых сумм копейки не показываем.
  const fractionDigits = Number.isInteger(value) ? 0 : 2

  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: currency.toUpperCase(),
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(value)
}
