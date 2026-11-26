#!/usr/bin/env node
// Проверка вариант-ориентированных документов после переиндексации.
// Индекс выбирается автоматически: активная версия у официального Search
// Module — последняя физическая (store_products_vN).
const HOST = "http://meilisearch:7700"
const KEY = process.env.MEILISEARCH_MASTER_KEY
const H = { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" }

async function request(method, path, body) {
  const r = await fetch(`${HOST}${path}`, { method, headers: H, body: body ? JSON.stringify(body) : undefined })
  const t = await r.text()
  let b = null
  try { b = t ? JSON.parse(t) : null } catch { b = t }
  if (!r.ok) throw new Error(`${r.status}: ${JSON.stringify(b).slice(0, 200)}`)
  return b
}

async function activeIndex() {
  const list = await request("GET", "/indexes?limit=100")
  const products = (list.results ?? []).filter((i) => /^store_products_v\d+$/.test(i.uid))
  products.sort((a, b) => a.uid.localeCompare(b.uid, undefined, { numeric: true }))
  if (!products.length) throw new Error("Индекс store_products не найден")
  return products[products.length - 1].uid
}

const IDX = await activeIndex()
console.log(`активный индекс: ${IDX}`)

async function search(body) {
  return request("POST", `/indexes/${IDX}/search`, body)
}

const main = async () => {
  const skus = ["TEE-MED-S-BLK", "TEE-MED-M-BLK", "TEE-MED-M-WHT", "SHOPPER-EKO-OS"]
  for (const sku of skus) {
    const result = await search({
      q: sku,
      limit: 1,
      attributesToRetrieve: ["sku", "attributes", "in_stock", "price", "category_handles", "collection_handles"],
    })
    console.log(JSON.stringify(result.hits?.[0]))
  }

  // Фасеты по динамическим характеристикам
  const facets = await search({ q: "", facets: ["attributes.brand", "attributes.color", "attributes.size", "attributes.eco", "attributes.rating"], limit: 0 })
  console.log("\nфасеты:", JSON.stringify(facets.facetDistribution))
  console.log("статистика рейтинга:", JSON.stringify(facets.facetStats))
}

main().catch((e) => { console.error(e); process.exit(1) })
