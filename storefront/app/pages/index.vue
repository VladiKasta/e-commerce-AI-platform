<script setup lang="ts">
import type { HttpTypes } from "@medusajs/types"
import type { CommerceErrorData } from "#shared/types/commerce"

const { storeName, region, currency, regionId, formatPrice, error: storeError } =
  useStore()
const commerce = useCommerce()

useHead({ title: "Главная" })

const HOME_PRODUCTS_LIMIT = 6

// Товары для главной: один запрос при SSR, результат передается в
// payload и не повторяется после hydration.
const { data: productsData, error: productsError } = await useAsyncData(
  "home-products",
  () =>
    commerce.products.list({
      limit: HOME_PRODUCTS_LIMIT,
      order: "-created_at",
      region_id: regionId.value ?? undefined,
    }),
  { watch: [regionId] }
)

const products = computed<HttpTypes.StoreProduct[]>(
  () => productsData.value?.products ?? []
)

const productsErrorData = computed<CommerceErrorData | null>(() => {
  const error = productsError.value
  if (!error) return null
  return {
    message: error.message,
    statusCode: "statusCode" in error ? error.statusCode : undefined,
  }
})

function priceText(product: HttpTypes.StoreProduct): string {
  return getProductPriceText(product, formatPrice, currency.value)
}
</script>

<template>
  <main class="mx-auto w-full max-w-5xl flex-1 px-4 py-10">
    <header class="mb-10">
      <h1 class="text-3xl font-bold tracking-tight sm:text-4xl">
        {{ storeName }}
      </h1>
      <p class="mt-2 text-neutral-600">
        Демонстрация eCommerce Starter Kit: данные получены из Medusa Store
        API через типизированный Commerce Client (SSR).
      </p>

      <div class="mt-4 flex flex-wrap items-center gap-2 text-sm">
        <span
          class="inline-flex items-center gap-2 rounded-full border px-3 py-1 font-medium"
          :class="
            region
              ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
              : 'border-amber-200 bg-amber-50 text-amber-700'
          "
        >
          <span
            class="h-2 w-2 rounded-full"
            :class="region ? 'bg-emerald-500' : 'bg-amber-500'"
          />
          {{
            region
              ? `Регион: ${region.name} (${currency.toUpperCase()})`
              : "Регионы не загружены"
          }}
        </span>
        <NuxtLink
          to="/catalog"
          class="rounded-full border border-neutral-300 px-3 py-1 font-medium text-neutral-700 transition hover:border-neutral-500"
        >
          Открыть каталог →
        </NuxtLink>
      </div>
    </header>

    <div
      v-if="storeError"
      class="mb-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700"
    >
      <p class="font-medium">Не удалось загрузить регионы магазина.</p>
      <p class="mt-1 opacity-80">{{ storeError.message }}</p>
    </div>

    <div
      v-if="productsErrorData"
      class="mb-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700"
    >
      <p class="font-medium">Не удалось загрузить товары из Medusa Store API.</p>
      <p class="mt-1 opacity-80">{{ productsErrorData.message }}</p>
    </div>

    <div
      v-else-if="products.length === 0"
      class="mb-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-700"
    >
      Товары не найдены. Проверьте, что seed-скрипт выполнен (`make seed`) и
      publishable API key связан с каналом продаж.
    </div>

    <section
      v-else
      class="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3"
    >
      <ProductCard
        v-for="product in products"
        :key="product.id"
        :product="product"
        :price-text="priceText(product)"
      />
    </section>
  </main>
</template>
