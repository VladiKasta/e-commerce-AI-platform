import type { HttpTypes } from "@medusajs/types"
import type { CommerceMoneyAmount } from "#shared/types/commerce"

/**
 * Сырые цены варианта Medusa (`fields=+*variants.prices`). Отсутствуют в
 * официальных типах варианта — присутствуют в ответе только при явном запросе.
 */
interface VariantWithRawPrices {
  prices?: Array<{
    currency_code: string
    amount: CommerceMoneyAmount
  }> | null
}

export interface ResolvedProductPrice {
  /** Минимальная цена среди вариантов (или null). */
  minAmount: number | null
  /** Максимальная цена среди вариантов (или null). */
  maxAmount: number | null
  /** Код валюты найденных цен (или null). */
  currencyCode: string | null
}

/**
 * Разрешает цену товара для отображения.
 *
 * Приоритет: рассчитанная цена в контексте региона (`calculated_price`,
 * возвращается автоматически при region_id) → сырые цены вариантов,
 * отфильтрованные по валюте (если запрошены через fields).
 *
 * Суммы Medusa — числа в основных единицах (1490 = 1490 ₽),
 * без деления на 100.
 */
export function resolveProductPrice(
  product: HttpTypes.StoreProduct,
  fallbackCurrency?: string
): ResolvedProductPrice {
  const variants = (product.variants ?? []) as Array<
    HttpTypes.StoreProductVariant & VariantWithRawPrices
  >

  // 1. Рассчитанные цены в региональном контексте.
  const calculated = variants
    .map((variant) => variant.calculated_price)
    .filter((price): price is NonNullable<typeof price> => Boolean(price))

  const calculatedAmounts = calculated
    .map((price) => Number(price.calculated_amount))
    .filter((amount) => Number.isFinite(amount))

  if (calculatedAmounts.length > 0) {
    const sorted = [...new Set(calculatedAmounts)].sort((a, b) => a - b)
    return {
      minAmount: sorted[0] ?? null,
      maxAmount: sorted[sorted.length - 1] ?? null,
      currencyCode: calculated[0]?.currency_code ?? null,
    }
  }

  // 2. Сырые цены вариантов в валюте магазина (fallback).
  const rawPrices = variants.flatMap((variant) => variant.prices ?? [])
  const matched = fallbackCurrency
    ? rawPrices.filter((price) => price.currency_code === fallbackCurrency)
    : rawPrices

  const amounts = matched
    .map((price) => Number(price.amount))
    .filter((amount) => Number.isFinite(amount))

  if (amounts.length === 0) {
    return { minAmount: null, maxAmount: null, currencyCode: null }
  }

  const sorted = [...new Set(amounts)].sort((a, b) => a - b)
  return {
    minAmount: sorted[0] ?? null,
    maxAmount: sorted[sorted.length - 1] ?? null,
    currencyCode: fallbackCurrency ?? null,
  }
}

/** Текст цены для карточки товара: «1 490 ₽» или «от 1 490 ₽». */
export function getProductPriceText(
  product: HttpTypes.StoreProduct,
  formatPrice: (amount: CommerceMoneyAmount | null | undefined, currency?: string) => string,
  currency: string
): string {
  const price = resolveProductPrice(product, currency)

  if (price.minAmount === null || !price.currencyCode) {
    return "Цена не указана"
  }

  const formatted = formatPrice(price.minAmount, price.currencyCode)

  return price.maxAmount !== null && price.maxAmount !== price.minAmount
    ? `от ${formatted}`
    : formatted
}
