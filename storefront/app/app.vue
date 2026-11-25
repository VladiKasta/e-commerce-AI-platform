<script setup lang="ts">
const config = useRuntimeConfig()
const { storeName, region, currency, initialize } = useStore()

// Инициализация контекста магазина (регионы, регион по умолчанию):
// на сервере выполняется один раз при SSR и не повторяется после
// hydration (callOnce использует payload).
await callOnce("store:initialize", () => initialize())

useHead({
  titleTemplate: (chunk) =>
    chunk ? `${chunk} — ${config.public.storeName}` : config.public.storeName,
  htmlAttrs: { lang: "ru" },
})
</script>

<template>
  <div class="flex min-h-screen flex-col bg-neutral-50 text-neutral-900">
    <header class="border-b border-neutral-200 bg-white">
      <div
        class="mx-auto flex max-w-5xl flex-col gap-2 px-4 py-4 sm:flex-row sm:items-center sm:justify-between"
      >
        <div class="flex items-center gap-4">
          <NuxtLink to="/" class="text-lg font-bold tracking-tight">
            {{ storeName }}
          </NuxtLink>
          <nav class="flex gap-3 text-sm text-neutral-600">
            <NuxtLink to="/catalog" class="transition hover:text-neutral-900">
              Каталог
            </NuxtLink>
          </nav>
        </div>

        <div class="flex items-center gap-2 text-xs text-neutral-500">
          <span v-if="region" class="rounded-full bg-neutral-100 px-2 py-1">
            Регион: {{ region.name }}
          </span>
          <span class="rounded-full bg-neutral-100 px-2 py-1 uppercase">
            {{ currency }}
          </span>
        </div>
      </div>
    </header>

    <NuxtPage />

    <footer class="mt-auto border-t border-neutral-200 bg-white">
      <div
        class="mx-auto flex max-w-5xl flex-col gap-1 px-4 py-6 text-sm text-neutral-500 sm:flex-row sm:items-center sm:justify-between"
      >
        <p>
          {{ config.public.storeName }} — техническая демо-страница eCommerce
          Starter Kit.
        </p>
        <p>Nuxt 4 SSR · Medusa v2 · Tailwind CSS</p>
      </div>
    </footer>
  </div>
</template>
