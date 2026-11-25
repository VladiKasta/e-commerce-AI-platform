<script setup lang="ts">
import type { HttpTypes } from "@medusajs/types"
import type { CommerceErrorData } from "#shared/types/commerce"

const route = useRoute()
const { currency, region, regionId, formatPrice } = useStore()
const commerce = useCommerce()

const handle = computed(() => {
  const value = route.params.handle
  if (Array.isArray(value)) {
    return value[0] ?? ""
  }
  return value ?? ""
})

const { data: product, error } = await useAsyncData(
  "product-by-handle",
  () =>
    commerce.products.getByHandle(handle.value, {
      region_id: regionId.value ?? undefined,
    }),
  { watch: [handle, regionId] }
)

// 404 для несуществующего товара — штатная обработка Nuxt (error.vue).
if (product.value === null && !error.value) {
  throw createError({
    statusCode: 404,
    statusMessage: "Товар не найден",
    fatal: true,
  })
}

useHead({
  title: () => product.value?.title ?? "Товар",
})

const errorData = computed<CommerceErrorData | null>(() => {
  if (!error.value) return null
  return {
    message: error.value.message,
    statusCode: "statusCode" in error.value ? error.value.statusCode : undefined,
  }
})

const variants = computed<HttpTypes.StoreProductVariant[]>(
  () => product.value?.variants ?? []
)

function variantPrice(variant: HttpTypes.StoreProductVariant): string {
  const amount = variant.calculated_price?.calculated_amount ?? null
  const priceCurrency = variant.calculated_price?.currency_code ?? currency.value
  return formatPrice(amount, priceCurrency)
}
</script>

<template>
  <main class="mx-auto w-full max-w-5xl flex-1 px-4 py-10">
    <div
      v-if="errorData"
      class="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700"
    >
      <p class="font-medium">Не удалось загрузить товар.</p>
      <p class="mt-1 opacity-80">{{ errorData.message }}</p>
      <NuxtLink to="/catalog" class="mt-3 inline-block underline">
        ← Вернуться в каталог
      </NuxtLink>
    </div>

    <template v-else-if="product">
      <nav class="mb-6 text-sm text-neutral-500">
        <NuxtLink to="/" class="hover:text-neutral-900">Главная</NuxtLink>
        <span class="mx-2">/</span>
        <NuxtLink to="/catalog" class="hover:text-neutral-900">Каталог</NuxtLink>
        <span class="mx-2">/</span>
        <span class="text-neutral-900">{{ product.title }}</span>
      </nav>

      <div class="grid grid-cols-1 gap-10 lg:grid-cols-2">
        <div class="space-y-4">
          <div class="overflow-hidden rounded-2xl border border-neutral-200 bg-white">
            <img
              v-if="product.images?.[0]?.url ?? product.thumbnail"
              :src="product.images?.[0]?.url ?? product.thumbnail ?? undefined"
              :alt="product.title"
              class="aspect-square w-full object-cover"
            >
            <div
              v-else
              class="flex aspect-square w-full items-center justify-center text-6xl text-neutral-300"
            >
              🛍️
            </div>
          </div>
          <div v-if="(product.images?.length ?? 0) > 1" class="grid grid-cols-4 gap-3">
            <div
              v-for="image in product.images"
              :key="image.id"
              class="overflow-hidden rounded-lg border border-neutral-200 bg-white"
            >
              <img
                :src="image.url"
                :alt="product.title"
                class="aspect-square w-full object-cover"
                loading="lazy"
              >
            </div>
          </div>
        </div>

        <div>
          <h1 class="text-3xl font-bold tracking-tight">{{ product.title }}</h1>
          <p v-if="product.subtitle" class="mt-1 text-neutral-500">
            {{ product.subtitle }}
          </p>

          <p class="mt-4 whitespace-pre-line text-neutral-700">
            {{ product.description }}
          </p>

          <section class="mt-8" aria-label="Варианты товара">
            <h2 class="text-sm font-semibold uppercase tracking-wide text-neutral-500">
              Варианты ({{ variants.length }})
            </h2>
            <ul class="mt-3 divide-y divide-neutral-200 rounded-xl border border-neutral-200 bg-white">
              <li
                v-for="variant in variants"
                :key="variant.id"
                class="flex items-center justify-between gap-4 px-4 py-3 text-sm"
              >
                <div>
                  <p class="font-medium text-neutral-900">{{ variant.title }}</p>
                  <p v-if="variant.sku" class="text-xs text-neutral-500">
                    Артикул: {{ variant.sku }}
                  </p>
                </div>
                <p class="font-semibold text-neutral-900">
                  {{ variantPrice(variant) }}
                </p>
              </li>
            </ul>
            <p class="mt-2 text-xs text-neutral-500">
              Цены рассчитаны для региона {{ region?.name ?? "по умолчанию" }}.
            </p>
          </section>

          <section
            v-if="(product.options?.length ?? 0) > 0"
            class="mt-6"
            aria-label="Характеристики"
          >
            <h2 class="text-sm font-semibold uppercase tracking-wide text-neutral-500">
              Характеристики
            </h2>
            <dl class="mt-3 space-y-1 text-sm">
              <div
                v-for="option in product.options"
                :key="option.id"
                class="flex gap-2"
              >
                <dt class="font-medium text-neutral-700">{{ option.title }}:</dt>
                <dd class="text-neutral-600">
                  {{ (option.values ?? []).map((value) => value.value).join(", ") }}
                </dd>
              </div>
            </dl>
          </section>
        </div>
      </div>
    </template>
  </main>
</template>
