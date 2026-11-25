<script setup lang="ts">
import type { HttpTypes } from "@medusajs/types"
import type { CommerceErrorData } from "#shared/types/commerce"

const PAGE_SIZE = 6

const route = useRoute()
const { currency, regionId, formatPrice } = useStore()
const commerce = useCommerce()

useHead({ title: "Каталог" })

const page = computed(() => {
  const raw = Number.parseInt(Array.isArray(route.query.page) ? route.query.page[0]! : route.query.page ?? "1", 10)
  return Number.isFinite(raw) && raw > 0 ? raw : 1
})

const offset = computed(() => (page.value - 1) * PAGE_SIZE)

const { data, pending, error } = await useAsyncData(
  "catalog-products",
  () =>
    commerce.products.list({
      limit: PAGE_SIZE,
      offset: offset.value,
      order: "-created_at",
      region_id: regionId.value ?? undefined,
    }),
  { watch: [page, regionId] }
)

const products = computed<HttpTypes.StoreProduct[]>(
  () => data.value?.products ?? []
)
const totalCount = computed(() => data.value?.count ?? 0)
const totalPages = computed(() =>
  Math.max(1, Math.ceil(totalCount.value / PAGE_SIZE))
)

const errorData = computed<CommerceErrorData | null>(() => {
  if (!error.value) return null
  return {
    message: error.value.message,
    statusCode: "statusCode" in error.value ? error.value.statusCode : undefined,
  }
})

function priceText(product: HttpTypes.StoreProduct): string {
  return getProductPriceText(product, formatPrice, currency.value)
}

function pageLink(target: number): Record<string, string | number> {
  return target === 1 ? {} : { page: target }
}
</script>

<template>
  <main class="mx-auto w-full max-w-5xl flex-1 px-4 py-10">
    <header class="mb-8">
      <h1 class="text-3xl font-bold tracking-tight">Каталог</h1>
      <p class="mt-2 text-sm text-neutral-600">
        Всего товаров: {{ totalCount }} · Страница {{ page }} из
        {{ totalPages }} · Валюта: {{ currency.toUpperCase() }}
      </p>
    </header>

    <div
      v-if="pending"
      class="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3"
      aria-busy="true"
    >
      <div
        v-for="index in PAGE_SIZE"
        :key="index"
        class="animate-pulse overflow-hidden rounded-xl border border-neutral-200 bg-white"
      >
        <div class="aspect-square w-full bg-neutral-200" />
        <div class="space-y-2 p-4">
          <div class="h-4 w-3/4 rounded bg-neutral-200" />
          <div class="h-4 w-1/4 rounded bg-neutral-200" />
        </div>
      </div>
    </div>

    <div
      v-else-if="errorData"
      class="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700"
    >
      <p class="font-medium">Не удалось загрузить каталог.</p>
      <p class="mt-1 opacity-80">{{ errorData.message }}</p>
    </div>

    <div
      v-else-if="products.length === 0"
      class="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-700"
    >
      Товары не найдены. Проверьте, что seed-скрипт выполнен (`make seed`).
    </div>

    <template v-else>
      <section class="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
        <ProductCard
          v-for="product in products"
          :key="product.id"
          :product="product"
          :price-text="priceText(product)"
        />
      </section>

      <nav
        v-if="totalPages > 1"
        class="mt-10 flex items-center justify-center gap-3 text-sm"
        aria-label="Пагинация каталога"
      >
        <NuxtLink
          :to="{ path: '/catalog', query: pageLink(page - 1) }"
          class="rounded-lg border border-neutral-300 px-4 py-2 font-medium transition hover:border-neutral-500"
          :class="page <= 1 ? 'pointer-events-none opacity-40' : ''"
          :aria-disabled="page <= 1"
        >
          ← Назад
        </NuxtLink>

        <span class="text-neutral-500">{{ page }} / {{ totalPages }}</span>

        <NuxtLink
          :to="{ path: '/catalog', query: pageLink(page + 1) }"
          class="rounded-lg border border-neutral-300 px-4 py-2 font-medium transition hover:border-neutral-500"
          :class="page >= totalPages ? 'pointer-events-none opacity-40' : ''"
          :aria-disabled="page >= totalPages"
        >
          Вперёд →
        </NuxtLink>
      </nav>
    </template>
  </main>
</template>
