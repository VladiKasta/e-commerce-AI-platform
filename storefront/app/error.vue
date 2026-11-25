<script setup lang="ts">
import type { NuxtError } from "#app"

defineProps<{
  error: NuxtError
}>()

const handleClearError = () => clearError({ redirect: "/" })
</script>

<template>
  <div
    class="flex min-h-screen flex-col items-center justify-center gap-4 bg-neutral-50 px-4 text-center"
  >
    <h1 class="text-4xl font-bold text-neutral-900">{{ error.statusCode }}</h1>
    <p class="max-w-md text-neutral-600">
      {{
        error.statusCode === 404
          ? "Страница не найдена."
          : "Что-то пошло не так. Попробуйте обновить страницу."
      }}
    </p>
    <button
      type="button"
      class="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-neutral-700"
      @click="handleClearError"
    >
      На главную
    </button>
  </div>
</template>
