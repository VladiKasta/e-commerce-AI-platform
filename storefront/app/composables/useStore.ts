import type { HttpTypes } from "@medusajs/types"
import { serializeCommerceError, toCommerceError } from "#shared/utils/commerce-error"
import type { CommerceErrorData, CommerceMoneyAmount } from "#shared/types/commerce"
import { formatPrice as formatMoney } from "~/utils/format-price"

/**
 * Публичный контекст магазина: название, локаль, регионы, валюта
 * и форматирование цен. Региональное состояние хранится в `useState`
 * (сериализуется в payload) и одинаково для всех компонентов;
 * `initialize()` вызывается один раз через `callOnce` в `app.vue`.
 *
 * Регион по умолчанию не хардкодится: выбирается по валюте магазина
 * из `runtimeConfig.public.storeCurrency`, иначе — первый доступный.
 */

export interface UseStoreReturn {
  /** Название магазина из runtimeConfig. */
  storeName: ComputedRef<string>
  /** Локаль витрины (форматирование цен через Intl.NumberFormat). */
  locale: ComputedRef<string>
  /** Код валюты текущего региона (fallback — валюта магазина). */
  currency: ComputedRef<string>
  /** Полный объект текущего региона или null. */
  region: ComputedRef<HttpTypes.StoreRegion | null>
  /** ID текущего региона или null. */
  regionId: Ref<string | null>
  /** Все доступные регионы (после initialize). */
  regions: Ref<HttpTypes.StoreRegion[]>
  /** Идет ли загрузка регионов. */
  pending: Ref<boolean>
  /** Сериализуемый снимок ошибки инициализации или null. */
  error: Ref<CommerceErrorData | null>
  /** Загружает регионы и выбирает регион по умолчанию (идемпотентен). */
  initialize: () => Promise<void>
  /** Переключает текущий регион (только на один из загруженных). */
  setRegion: (regionId: string) => void
  /** Форматирует сумму Medusa (основные единицы) в валюту региона. */
  formatPrice: (amount: CommerceMoneyAmount | null | undefined, currencyCode?: string) => string
}

/** Регион по умолчанию: валюта магазина, иначе первый доступный. */
function pickDefaultRegion(
  candidates: HttpTypes.StoreRegion[],
  storeCurrency: string
): HttpTypes.StoreRegion | null {
  return (
    candidates.find((region) => region.currency_code === storeCurrency) ??
    candidates[0] ??
    null
  )
}

export function useStore(): UseStoreReturn {
  const config = useRuntimeConfig()
  const commerce = useCommerce()

  const regions = useState<HttpTypes.StoreRegion[]>("store:regions", () => [])
  const regionId = useState<string | null>("store:regionId", () => null)
  const pending = useState<boolean>("store:pending", () => false)
  const error = useState<CommerceErrorData | null>("store:error", () => null)

  const storeName = computed(() => config.public.storeName)
  const locale = computed(() => config.public.storeLocale)

  const region = computed(
    () => regions.value.find((item) => item.id === regionId.value) ?? null
  )

  const currency = computed(
    () => region.value?.currency_code ?? config.public.storeCurrency
  )

  async function initialize(): Promise<void> {
    // Идемпотентность: уже загружено или загрузка идет — не повторяем.
    if (pending.value || regions.value.length > 0) {
      return
    }

    pending.value = true
    error.value = null

    try {
      const response = await commerce.regions.list()
      regions.value = response.regions

      if (!regionId.value) {
        regionId.value =
          pickDefaultRegion(response.regions, config.public.storeCurrency)?.id ??
          null
      }
    } catch (cause) {
      // Не возвращаем успешный результат при фактической ошибке:
      // фиксируем снимок ошибки в состоянии магазина.
      error.value = serializeCommerceError(toCommerceError(cause))
    } finally {
      pending.value = false
    }
  }

  function setRegion(nextRegionId: string): void {
    // Переключаемся только на реально существующий регион.
    if (!regions.value.some((item) => item.id === nextRegionId)) {
      return
    }
    regionId.value = nextRegionId
  }

  function formatPrice(
    amount: CommerceMoneyAmount | null | undefined,
    currencyCode?: string
  ): string {
    return formatMoney(amount, currencyCode ?? currency.value, locale.value)
  }

  return {
    storeName,
    locale,
    currency,
    region,
    regionId,
    regions,
    pending,
    error,
    initialize,
    setRegion,
    formatPrice,
  }
}
