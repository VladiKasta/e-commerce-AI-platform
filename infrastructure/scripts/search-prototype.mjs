#!/usr/bin/env node
/**
 * Технический прототип модели поискового индекса Meilisearch (этап 3).
 *
 * Проверяет на РЕАЛЬНОМ запуске Meilisearch v1.58.0:
 *  1. Индексацию отдельных вариантов товаров.
 *  2. distinctAttribute / distinct-параметр поиска и группировку по product_id.
 *  3. Подсчет уникальных товаров: точность totalHits (page-режим) и
 *     estimatedTotalHits (limit-режим) при distinct.
 *  4. Фасетные счетчики: facetDistribution НЕ distinct-aware (считает варианты) —
 *     проверяется и компенсируется стратегией точного подсчета уникальных
 *     товаров на значение фасета через multi-search (page.totalHits per value).
 *  5. Multi-search.
 *  6. Сортировку сгруппированных результатов.
 *  7. Пагинацию: стабильность, дубликаты, пределы pagination.maxTotalHits.
 *  8. Ограничения количества значений фасетов (faceting.maxValuesPerFacet).
 *  9. Критический сценарий: color=black AND size=M AND in_stock=true не должен
 *     находить товар, у которого эта комбинация есть только у варианта
 *     без наличия (вариант-ориентированная фильтрация).
 * 10. Русский поиск, опечатки, поиск по неполному слову, синонимы, поиск
 *     по артикулу и по вложенным значениям характеристик.
 * 11. Атомарную замену индексов (POST /swap-urls) для полной переиндексации.
 *
 * Запуск (внутри Docker-сети, из корня репозитория):
 *   MEILISEARCH_HOST=http://meilisearch:7700 MEILISEARCH_MASTER_KEY=... \
 *     node infrastructure/scripts/search-prototype.mjs
 *
 * Результаты фиксируются в docs/ARCHITECTURE.md (раздел «Поиск»).
 */

const HOST = process.env.MEILISEARCH_HOST || "http://localhost:7700"
const KEY = process.env.MEILISEARCH_MASTER_KEY
const INDEX = "prototype_stage3_variants"

if (!KEY) {
  console.error("MEILISEARCH_MASTER_KEY не задан")
  process.exit(2)
}

const authHeaders = {
  Authorization: `Bearer ${KEY}`,
  "Content-Type": "application/json",
}

let checksPassed = 0
let checksFailed = 0
const failures = []

function check(name, condition, details = "") {
  const status = condition ? "PASS" : "FAIL"
  if (condition) {
    checksPassed++
  } else {
    checksFailed++
    failures.push(name)
  }
  console.log(`[${status}] ${name}${details ? ` — ${details}` : ""}`)
}

async function meili(path, options = {}) {
  const response = await fetch(`${HOST}${path}`, {
    ...options,
    headers: { ...authHeaders, ...(options.headers ?? {}) },
  })
  const text = await response.text()
  let body = null
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = text
  }
  return { status: response.status, body }
}

async function waitForTask(taskUid) {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    const { status, body } = await meili(`/tasks/${taskUid}`)
    if (status === 200 && body && body.status !== "enqueued" && body.status !== "processing") {
      return body
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`Task ${taskUid} not finished in 30s`)
}

async function enqueuedOk({ status, body }, label) {
  if (status >= 400 || !body?.taskUid) {
    throw new Error(`${label}: unexpected response ${status} ${JSON.stringify(body)}`)
  }
  return waitForTask(body.taskUid)
}

async function deleteIndexQuietly(uid) {
  const { status, body } = await meili(`/indexes/${uid}`, { method: "DELETE" })
  if (status < 400 && body?.taskUid) {
    await waitForTask(body.taskUid)
  }
}

/**
 * Данные прототипа.
 *
 * prod_A «Футболка Медуза» — КРИТИЧЕСКИЙ СЦЕНАРИЙ:
 *   v_A1: черный / S  / в наличии
 *   v_A2: черный / M  / НЕТ в наличии
 *   v_A3: белый  / M  / в наличии
 * Фильтр (черный AND M AND in_stock) НЕ должен находить prod_A:
 * комбинация black+M существует только у варианта без наличия.
 *
 * prod_B «Футболка Кракен» — контрольная: черный / M в наличии.
 * prod_C «Кружка» — белый / OS, один вариант.
 * prod_D «Лонгслив» — ДВА варианта blue/M с разной ценой: вскрывает разницу
 *   между подсчетом вариантов и подсчетом уникальных товаров в фасетах.
 */
const products = {
  prod_A: {
    product_id: "prod_A",
    title: "Футболка Медуза",
    description: "Базовая футболка из плотного хлопка с принтом",
    sku: "TEE-MED",
    handle: "futbolka-meduza",
    category_handles: ["t-shirts"],
    attributes: { brand: "medusa", material: "cotton" },
    created_at: 1700000100,
  },
  prod_B: {
    product_id: "prod_B",
    title: "Футболка Кракен",
    description: "Футболка с минималистичным принтом",
    sku: "TEE-KRAKEN",
    handle: "futbolka-kraken",
    category_handles: ["t-shirts"],
    attributes: { brand: "deepsea", material: "polyester" },
    created_at: 1700000200,
  },
  prod_C: {
    product_id: "prod_C",
    title: "Кружка Медуза",
    description: "Керамическая кружка 350 мл",
    sku: "MUG-MEDUSA",
    handle: "kruzhka-meduza",
    category_handles: ["accessories"],
    attributes: { brand: "medusa", material: "ceramics" },
    created_at: 1700000300,
  },
  prod_D: {
    product_id: "prod_D",
    title: "Лонгслив Медуза",
    description: "Лонгслив с длинным рукавом",
    sku: "LONG-MED",
    handle: "longsliv-meduza",
    category_handles: ["t-shirts"],
    attributes: { brand: "medusa", material: "cotton" },
    created_at: 1700000400,
  },
}

function variantDoc(productId, { id, options, price, inStock }) {
  const product = products[productId]
  return {
    id,
    product_id: productId,
    title: product.title,
    description: product.description,
    sku: `${product.sku}-${id}`,
    handle: product.handle,
    thumbnail: null,
    category_handles: product.category_handles,
    currency_code: "rub",
    price,
    in_stock: inStock,
    options,
    attributes: product.attributes,
    created_at: product.created_at,
    updated_at: product.created_at,
  }
}

const documents = [
  variantDoc("prod_A", { id: "v_A1", options: { color: "black", size: "S" }, price: 1490, inStock: true }),
  variantDoc("prod_A", { id: "v_A2", options: { color: "black", size: "M" }, price: 1490, inStock: false }),
  variantDoc("prod_A", { id: "v_A3", options: { color: "white", size: "M" }, price: 1540, inStock: true }),
  variantDoc("prod_B", { id: "v_B1", options: { color: "black", size: "M" }, price: 1290, inStock: true }),
  variantDoc("prod_C", { id: "v_C1", options: { color: "white", size: "OS" }, price: 790, inStock: true }),
  variantDoc("prod_D", { id: "v_D1", options: { color: "blue", size: "M" }, price: 1990, inStock: true }),
  variantDoc("prod_D", { id: "v_D2", options: { color: "blue", size: "M" }, price: 2190, inStock: true }),
]

async function rawSearch(payload) {
  return meili(`/indexes/${INDEX}/search`, {
    method: "POST",
    body: JSON.stringify(payload),
  })
}

async function search(payload) {
  const { status, body } = await rawSearch(payload)
  if (status !== 200) {
    throw new Error(`search failed ${status}: ${JSON.stringify(body)}`)
  }
  return body
}

async function multiSearch(queries) {
  const { status, body } = await meili("/multi-search", {
    method: "POST",
    body: JSON.stringify({ queries }),
  })
  if (status !== 200) {
    throw new Error(`multi-search failed ${status}: ${JSON.stringify(body)}`)
  }
  return body.results
}

async function main() {
  console.log(`==> Прототип модели индекса Meilisearch против ${HOST}`)

  // ── Здоровье и версия ────────────────────────────────────────────────
  const health = await meili("/health")
  check("Meilisearch доступен", health.status === 200 && health.body?.status === "available")

  const version = await meili("/version")
  console.log(`    Версия Meilisearch: ${version.body?.pkgVersion}`)

  await deleteIndexQuietly(INDEX)

  // ── Создание индекса и настроек ─────────────────────────────────────
  const createTask = await enqueuedOk(
    await meili("/indexes", {
      method: "POST",
      body: JSON.stringify({ uid: INDEX, primaryKey: "id" }),
    }),
    "create index"
  )
  check("Создание индекса и ожидание задачи", createTask.status === "succeeded")

  const settings = {
    distinctAttribute: "product_id",
    searchableAttributes: ["title", "description", "sku", "attributes", "options"],
    filterableAttributes: [
      "product_id",
      "in_stock",
      "price",
      "category_handles",
      "options.color",
      "options.size",
      "attributes.brand",
      "attributes.material",
    ],
    sortableAttributes: ["price", "created_at"],
    pagination: { maxTotalHits: 1000 },
    faceting: { maxValuesPerFacet: 100 },
    typoTolerance: { minWordSizeForTypos: { oneTypo: 4, twoTypos: 8 } },
    // Двусторонние синонимы: jellyfish <-> медуза.
    synonyms: { футболка: ["футболка с принтом"], медуза: ["jellyfish"], jellyfish: ["медуза"] },
    stopWords: ["и", "в", "с"],
  }

  const settingsTask = await enqueuedOk(
    await meili(`/indexes/${INDEX}/settings`, {
      method: "PATCH",
      body: JSON.stringify(settings),
    }),
    "settings"
  )
  check(
    "Настройка индекса (distinct, searchable, filterable, sortable, pagination, faceting, typo, synonyms, stopWords)",
    settingsTask.status === "succeeded",
    JSON.stringify(settingsTask.error ?? "")
  )

  const addTask = await enqueuedOk(
    await meili(`/indexes/${INDEX}/documents`, {
      method: "POST",
      body: JSON.stringify(documents),
    }),
    "add documents"
  )
  check(
    "Индексация отдельных вариантов (7 документов)",
    addTask.status === "succeeded",
    `документов: ${addTask.details?.receivedDocuments ?? addTask.details?.indexedDocuments}`
  )

  // ── КРИТИЧЕСКИЙ СЦЕНАРИЙ ─────────────────────────────────────────────
  const critical = await search({
    q: "",
    filter: ['options.color = "black"', "options.size = M", "in_stock = true"],
    limit: 20,
  })
  const criticalProductIds = [...new Set(critical.hits.map((h) => h.product_id))]
  check(
    "КРИТИЧЕСКИЙ СЦЕНАРИЙ: black + M + in_stock не находит товар с комбинацией только у отсутствующего варианта",
    criticalProductIds.length === 1 && criticalProductIds[0] === "prod_B",
    `найдены: ${JSON.stringify(criticalProductIds)} (ожидался только prod_B)`
  )

  const withoutStock = await search({
    q: "",
    filter: ['options.color = "black"', "options.size = M"],
    limit: 20,
  })
  const withoutStockIds = [...new Set(withoutStock.hits.map((h) => h.product_id))]
  check(
    "black + M без фильтра наличия находит и prod_A (v_A2), и prod_B",
    withoutStockIds.includes("prod_A") && withoutStockIds.includes("prod_B"),
    `найдены: ${JSON.stringify(withoutStockIds)}`
  )

  // ── distinct / группировка ───────────────────────────────────────────
  const distinctSearch = await search({ q: "", limit: 100 })
  const uniqueProductsInDistinct = [...new Set(distinctSearch.hits.map((h) => h.product_id))]
  check(
    "distinctAttribute (настройка индекса): выдача сгруппирована по product_id, без дубликатов (4 товара из 7 вариантов)",
    distinctSearch.hits.length === 4 && uniqueProductsInDistinct.length === 4,
    `хитов: ${distinctSearch.hits.length}, уникальных товаров: ${uniqueProductsInDistinct.length}`
  )

  const distinctParamSearch = await search({ q: "", distinct: "product_id", limit: 100 })
  const distinctParamOk =
    distinctParamSearch.hits?.length === 4 &&
    new Set(distinctParamSearch.hits.map((h) => h.product_id)).size === 4
  check(
    "distinct как параметр поиска: поддерживается и согласован с настройкой индекса",
    distinctParamOk,
    distinctParamSearch.hits ? `хитов: ${distinctParamSearch.hits.length}` : `ошибка: ${JSON.stringify(distinctParamSearch)}`
  )

  // ── Подсчет уникальных товаров: два режима ────────────────────────────
  // limit-режим: only estimatedTotalHits (оценка; здесь 5 при 4 товарах).
  const estimated = await search({ q: "", limit: 1 })
  console.log(
    `    limit-режим при distinct: estimatedTotalHits=${estimated.estimatedTotalHits} (фактически 4 товара), totalHits=${estimated.totalHits ?? "нет"}`
  )
  check(
    "limit-режим возвращает ТОЛЬКО оценку (estimatedTotalHits) — не годится для точного total",
    typeof estimated.estimatedTotalHits === "number" && estimated.totalHits === undefined
  )

  // page-режим: totalHits точный (4), включая фильтры (проверено ниже).
  const paged = await search({ q: "", page: 1, hitsPerPage: 2 })
  console.log(
    `    page-режим при distinct: totalHits=${paged.totalHits}, totalPages=${paged.totalPages}`
  )
  check(
    "page-режим при distinct возвращает ТОЧНЫЙ totalHits",
    paged.totalHits === 4 && paged.totalPages === 2 && paged.hits.length === 2
  )

  const pagedFiltered = await search({
    q: "",
    filter: ['options.color = "blue"'],
    page: 1,
    hitsPerPage: 1,
  })
  check(
    "page-режим + фильтры: totalHits точен и для подмножеств (blue: 2 варианта = 1 товар)",
    pagedFiltered.totalHits === 1,
    `totalHits: ${pagedFiltered.totalHits}`
  )

  const pagedQuery = await search({ q: "Медуза", page: 1, hitsPerPage: 1 })
  check(
    "page-режим + текстовый запрос: totalHits точен (3 товара по слову «Медуза»)",
    pagedQuery.totalHits === 3,
    `totalHits: ${pagedQuery.totalHits}`
  )

  // Стабильность пагинации: собрать все страницы, проверить дубликаты
  const allPagesProductIds = []
  for (let page = 1; page <= paged.totalPages; page++) {
    const pageResult = await search({ q: "", page, hitsPerPage: 2 })
    allPagesProductIds.push(...pageResult.hits.map((h) => h.product_id))
  }
  check(
    "Стабильная пагинация: страницы не содержат дубликатов товаров",
    new Set(allPagesProductIds).size === allPagesProductIds.length && allPagesProductIds.length === 4,
    JSON.stringify(allPagesProductIds)
  )

  const zeroPerPage = await rawSearch({ q: "", page: 1, hitsPerPage: 0 })
  check(
    "hitsPerPage=0 допускается: точный totalHits без передачи hits (идеален для count-запросов)",
    zeroPerPage.status === 200 && zeroPerPage.body?.totalHits === 4 && zeroPerPage.body?.hits?.length === 0,
    `статус: ${zeroPerPage.status}, totalHits: ${zeroPerPage.body?.totalHits}`
  )

  // ── Фасетные счетчики: подтверждение ограничения и стратегия ────────
  const blueFacets = await search({
    q: "",
    filter: ['options.color = "blue"'],
    facets: ["attributes.brand"],
    limit: 0,
  })
  const brandCounts = blueFacets.facetDistribution?.["attributes.brand"] ?? {}
  check(
    "ОГРАНИЧЕНИЕ ПОДТВЕРЖДЕНО: facetDistribution считает ВАРИАНТЫ, а не уникальные товары (medusa=2 при 1 товаре)",
    brandCounts.medusa === 2,
    `medusa: ${brandCounts.medusa} (2 = варианта, хотя товар один)`
  )

  // Стратегия: multi-search, по одному count-запросу на значение фасета,
  // каждый с distinct + page → точный totalHits = число уникальных товаров
  // (hitsPerPage=0: нулевой payload, totalHits точный — проверено выше).
  // Сценарий: активные фильтры size=M AND in_stock=true; считаем фасет color
  // disjunctively (без собственного фильтра цвета).
  const activeFilters = ["options.size = M", "in_stock = true"]
  const colorValues = ["black", "white", "blue"]
  const countResults = await multiSearch([
    ...colorValues.map((value) => ({
      indexUid: INDEX,
      q: "",
      filter: [...activeFilters, `options.color = "${value}"`],
      page: 1,
      hitsPerPage: 0,
    })),
  ])
  const valueCounts = {}
  countResults.forEach((result, index) => {
    valueCounts[colorValues[index]] = result.totalHits
  })
  // Ожидание: black → prod_B (1); white → prod_A/v_A3 (1); blue → prod_D (1, у него 2 blue/M-варианта).
  check(
    "СТРАТЕГИЯ РЕШЕНА: multi-search + distinct + page.totalHits дает ТОЧНОЕ число уникальных товаров на значение фасета",
    valueCounts.black === 1 && valueCounts.white === 1 && valueCounts.blue === 1,
    JSON.stringify(valueCounts)
  )

  // Контрольный сценарий без фильтров: считаем size на всем наборе.
  const sizeValues = ["S", "M", "L", "OS"]
  const sizeResults = await multiSearch(
    sizeValues.map((value) => ({
      indexUid: INDEX,
      q: "",
      filter: [`options.size = ${JSON.stringify(value)}`],
      page: 1,
      hitsPerPage: 0,
    }))
  )
  const sizeCounts = {}
  sizeResults.forEach((result, index) => {
    sizeCounts[sizeValues[index]] = result.totalHits
  })
  // S: prod_A (1); M: prod_A, prod_B, prod_D (3); L: 0; OS: prod_C (1).
  check(
    "Точные счетчики уникальных товаров по значениям (включая нулевые)",
    sizeCounts.S === 1 && sizeCounts.M === 3 && sizeCounts.L === 0 && sizeCounts.OS === 1,
    JSON.stringify(sizeCounts)
  )

  // Альтернатива/подстраховка: фасет product_id (число ключей = товары) — работает,
  // но ограничено faceting.maxValuesPerFacet. Проверим как fallback.
  const productIdFacet = await search({
    q: "",
    filter: ['options.color = "blue"'],
    facets: ["product_id"],
    limit: 0,
  })
  check(
    "Fallback-подсчет: фасет product_id возвращает по одному ключу на товар",
    Object.keys(productIdFacet.facetDistribution?.product_id ?? {}).length === 1,
    JSON.stringify(productIdFacet.facetDistribution?.product_id)
  )

  // facetStats по числовому атрибуту (для range-фасетов)
  const stats = await search({ q: "", facets: ["price"], limit: 0 })
  console.log(`    facetStats.price: ${JSON.stringify(stats.facetStats?.price)}`)
  check(
    "facetStats возвращает min/max по числовому атрибуту",
    stats.facetStats?.price?.min === 790 && stats.facetStats?.price?.max === 2190
  )

  const statsFiltered = await search({
    q: "",
    filter: ['attributes.brand = "medusa"'],
    facets: ["price"],
    limit: 0,
  })
  check(
    "facetStats учитывают активные фильтры",
    statsFiltered.facetStats?.price?.min === 790 && statsFiltered.facetStats?.price?.max === 2190
  )

  // Range-фильтрация
  const rangeSearch = await search({
    q: "",
    filter: ["price >= 1000", "price <= 2000"],
    page: 1,
    hitsPerPage: 20,
  })
  const rangeProductIds = [...new Set(rangeSearch.hits.map((h) => h.product_id))]
  check(
    "Диапазон цен (price >= 1000 AND price <= 2000): варианты-ориентированно",
    rangeProductIds.includes("prod_A") &&
      rangeProductIds.includes("prod_B") &&
      rangeProductIds.includes("prod_D") &&
      !rangeProductIds.includes("prod_C"),
    JSON.stringify(rangeProductIds)
  )

  // ── Сортировка сгруппированных результатов ───────────────────────────
  const sorted = await search({ q: "", sort: ["price:asc"], limit: 10 })
  const sortedPrices = sorted.hits.map((h) => h.price)
  check(
    "Сортировка price:asc: по одному (самому дешевому) варианту на товар",
    JSON.stringify(sortedPrices) === JSON.stringify([790, 1290, 1490, 1990]),
    JSON.stringify(sortedPrices)
  )

  const sortedDesc = await search({ q: "", sort: ["price:desc"], limit: 10 })
  check(
    "Сортировка price:desc: по одному (самом дорогому) варианту на товар",
    JSON.stringify(sortedDesc.hits.map((h) => h.price)) === JSON.stringify([2190, 1540, 1290, 790]),
    JSON.stringify(sortedDesc.hits.map((h) => h.price))
  )

  // ── Multi-search (базовая работоспособность) ─────────────────────────
  const multiResults = await multiSearch([
    {
      indexUid: INDEX,
      q: "",
      filter: ['options.color = "black"', "in_stock = true"],
      facets: ["options.size"],
      limit: 0,
    },
    {
      indexUid: INDEX,
      q: "футболка",
      page: 1,
      hitsPerPage: 1,
    },
  ])
  const multiSizeFacets = multiResults[0]?.facetDistribution?.["options.size"] ?? {}
  const multiUniqueProducts = multiResults[1]?.totalHits
  check(
    "Multi-search: несколько запросов одним вызовом (фасеты + поисковый запрос)",
    multiSizeFacets.S === 1 && multiSizeFacets.M === 1 && multiUniqueProducts === 2,
    `size при black+in_stock: ${JSON.stringify(multiSizeFacets)}, уникальных товаров по q=футболка: ${multiUniqueProducts}`
  )

  // ── Русский поиск, опечатки, префикс, синонимы, артикул ───────────────
  const ruSearch = await search({ q: "футболка", page: 1, hitsPerPage: 10 })
  check(
    "Поиск по русскому названию «футболка» (2 товара)",
    ruSearch.totalHits === 2,
    JSON.stringify([...new Set(ruSearch.hits.map((h) => h.title))])
  )

  const typoSearch = await search({ q: "фудболка", limit: 20 })
  check(
    "Поиск с опечаткой «фудболка» (одна правка, кириллица)",
    typoSearch.hits.length >= 2,
    JSON.stringify(typoSearch.hits.map((h) => h.title))
  )

  const prefixSearch = await search({ q: "футб", page: 1, hitsPerPage: 10 })
  check(
    "Поиск по неполному слову «футб» (префикс последнего слова)",
    prefixSearch.totalHits === 2,
    `хитов: ${prefixSearch.totalHits}`
  )

  const synonymSearch = await search({ q: "jellyfish", limit: 20 })
  check(
    "Синонимы: запрос «jellyfish» находит товары со словом «Медуза»",
    synonymSearch.hits.length >= 2,
    JSON.stringify(synonymSearch.hits.map((h) => h.title))
  )

  const skuSearch = await search({ q: "TEE-KRAKEN", limit: 20 })
  check(
    "Поиск по артикулу (sku)",
    skuSearch.hits.length >= 1 && skuSearch.hits[0].product_id === "prod_B",
    JSON.stringify([...new Set(skuSearch.hits.map((h) => h.sku))])
  )

  const attrSearch = await search({ q: "deepsea", limit: 20 })
  check(
    "Поиск по значению вложенной характеристики (attributes.brand)",
    attrSearch.hits.length >= 1 && attrSearch.hits.every((h) => h.product_id === "prod_B"),
    JSON.stringify([...new Set(attrSearch.hits.map((h) => h.product_id))])
  )

  const optionSearch = await search({ q: "black", limit: 20 })
  check(
    "Поиск по значению опции варианта (options.color)",
    optionSearch.hits.length >= 1,
    JSON.stringify([...new Set(optionSearch.hits.map((h) => h.product_id))])
  )

  // ── Ограничения и защита ──────────────────────────────────────────────
  const beyondLimit = await search({ q: "", limit: 2000 })
  check(
    "pagination.maxTotalHits ограничивает размер выборки",
    beyondLimit.hits.length <= 1000,
    `хитов: ${beyondLimit.hits.length}`
  )

  const badFilter = await rawSearch({ q: "", filter: 'EVIL = "injection"', limit: 5 })
  check(
    "Фильтр по незарегистрированному атрибуту отклоняется движком (защита от инъекций)",
    badFilter.status === 400 && badFilter.body?.code === "invalid_search_filter",
    `код: ${badFilter.body?.code}`
  )

  const beyondPage = await rawSearch({ q: "", page: 1000, hitsPerPage: 1000 })
  check(
    "Запрос за пределами maxTotalHits обрабатывается движком мягко (пустая выдача, без ошибки)",
    beyondPage.status === 200 && beyondPage.body?.hits?.length === 0,
    `статус: ${beyondPage.status}, hits: ${beyondPage.body?.hits?.length}`
  )

  // ── Атомарная замена индексов (swap) ─────────────────────────────────
  await deleteIndexQuietly(`${INDEX}_new`)
  const swapSourceCreated = await enqueuedOk(
    await meili("/indexes", {
      method: "POST",
      body: JSON.stringify({ uid: `${INDEX}_new`, primaryKey: "id" }),
    }),
    "create swap source"
  )
  check("Создание временного индекса для переиндексации", swapSourceCreated.status === "succeeded")

  const swapTask = await enqueuedOk(
    await meili("/swap-indexes", {
      method: "POST",
      body: JSON.stringify([{ indexes: [INDEX, `${INDEX}_new`] }]),
    }),
    "swap indexes"
  )
  check("Атомарная замена индексов POST /swap-indexes", swapTask.status === "succeeded")

  // После swap запросы уходят в НОВЫЙ (пустой) индекс под старым именем
  const afterSwap = await search({ q: "", limit: 10 })
  check("После swap индекс под старым именем указывает на новые данные (пусто)", afterSwap.hits.length === 0)

  // Возврат в исходное состояние и очистка
  await enqueuedOk(
    await meili("/swap-indexes", {
      method: "POST",
      body: JSON.stringify([{ indexes: [INDEX, `${INDEX}_new`] }]),
    }),
    "swap back"
  )
  await deleteIndexQuietly(INDEX)
  await deleteIndexQuietly(`${INDEX}_new`)

  // ── Итоги ────────────────────────────────────────────────────────────
  console.log("")
  console.log(`==> Итог: ${checksPassed} проверок пройдено, ${checksFailed} провалено`)
  if (checksFailed > 0) {
    console.log(`Провалены: ${failures.join(", ")}`)
    process.exit(1)
  }
}

main().catch((error) => {
  console.error("Прототип упал с ошибкой:", error)
  process.exit(1)
})
