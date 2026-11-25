<script setup lang="ts">
import type { HttpTypes } from "@medusajs/types"

defineProps<{
  product: HttpTypes.StoreProduct
  priceText: string
}>()
</script>

<template>
  <article
    class="group overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm transition hover:shadow-md"
  >
    <NuxtLink :to="`/product/${product.handle}`" class="block">
      <div class="aspect-square w-full overflow-hidden bg-neutral-100">
        <img
          v-if="product.images?.[0]?.url ?? product.thumbnail"
          :src="product.images?.[0]?.url ?? product.thumbnail ?? undefined"
          :alt="product.title"
          class="h-full w-full object-cover transition group-hover:scale-105"
          loading="lazy"
        >
        <div
          v-else
          class="flex h-full w-full items-center justify-center text-4xl text-neutral-300"
        >
          🛍️
        </div>
      </div>
      <div class="flex items-start justify-between gap-2 p-4">
        <h2 class="text-sm font-medium leading-snug text-neutral-900">
          {{ product.title }}
        </h2>
        <p class="shrink-0 text-sm font-semibold text-neutral-900">
          {{ priceText }}
        </p>
      </div>
    </NuxtLink>
  </article>
</template>
