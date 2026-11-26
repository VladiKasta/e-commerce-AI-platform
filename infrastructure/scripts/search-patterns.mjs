#!/usr/bin/env node
// Проверка wildcard-паттернов Meilisearch в filterableAttributes:
// позволяет ли ["attributes.*"] фильтровать/фасетировать ДИНАМИЧЕСКИЕ поля
// (attributes.brand, attributes.rating) без их явного перечисления.
const HOST = process.env.MEILISEARCH_HOST || "http://localhost:7700"
const KEY = process.env.MEILISEARCH_MASTER_KEY
const IDX = "probe_patterns"
const H = { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" }

async function req(method, path, body) {
  const r = await fetch(`${HOST}${path}`, {
    method,
    headers: H,
    body: body ? JSON.stringify(body) : undefined,
  })
  const t = await r.text()
  let b = null
  try {
    b = t ? JSON.parse(t) : null
  } catch {
    b = t
  }
  return { status: r.status, body: b }
}

async function wait(uid) {
  for (let i = 0; i < 200; i++) {
    const { body } = await req("GET", `/tasks/${uid}`)
    if (body?.status && !["enqueued", "processing"].includes(body.status)) return body
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error("task timeout")
}

async function main() {
  const del = await req("DELETE", `/indexes/${IDX}`)
  if (del.body?.taskUid) await wait(del.body.taskUid)

  const created = await req("POST", "/indexes", { uid: IDX, primaryKey: "id" })
  await wait(created.body.taskUid)

  // Паттерны вместо явного перечисления динамических полей
  const settingsTask = await req("PATCH", `/indexes/${IDX}/settings`, {
    distinctAttribute: "product_id",
    searchableAttributes: ["title", "sku", "attributes"],
    filterableAttributes: ["product_id", "price", "in_stock", "attributes.*"],
    sortableAttributes: ["price"],
    faceting: { maxValuesPerFacet: 100 },
  })
  const settings = await wait(settingsTask.body.taskUid)
  console.log(`настройки с паттерном attributes.*: ${settings.status}`)
  if (settings.error) console.log(JSON.stringify(settings.error))

  const add = await req("POST", `/indexes/${IDX}/documents`, [
    { id: "v1", product_id: "p1", title: "Футболка Медуза", sku: "TEE-1", price: 1490, in_stock: true, attributes: { brand: "medusa", color: "black", rating: 4.5, eco: true } },
    { id: "v2", product_id: "p1", title: "Футболка Медуза", sku: "TEE-2", price: 1590, in_stock: false, attributes: { brand: "medusa", color: "white", rating: 4.5, eco: true } },
    { id: "v3", product_id: "p2", title: "Кружка", sku: "MUG-1", price: 790, in_stock: true, attributes: { brand: "deepsea", color: "white", rating: 3.0, eco: false } },
  ])
  await wait(add.body.taskUid)
  console.log("документы добавлены (динамические вложенные поля)")

  // 1. Фильтр по динамическому полю через паттерн
  const f1 = await req("POST", `/indexes/${IDX}/search`, {
    q: "",
    filter: ['attributes.brand = "medusa"', "in_stock = true"],
    limit: 10,
  })
  console.log(`фильтр attributes.brand=medusa AND in_stock: ${f1.status} hits=${JSON.stringify(f1.body?.hits?.map((h) => h.id))}`)

  // 2. Фильтр по строковому значению опции/атрибута (кириллица)
  const f2 = await req("POST", `/indexes/${IDX}/search`, {
    q: "",
    filter: ['attributes.color = "black"'],
    limit: 10,
  })
  console.log(`фильтр attributes.color=black: ${f2.status} hits=${JSON.stringify(f2.body?.hits?.map((h) => h.id))}`)

  // 3. Числовой диапазон по динамическому полю
  const f3 = await req("POST", `/indexes/${IDX}/search`, {
    q: "",
    filter: ["attributes.rating >= 4"],
    limit: 10,
  })
  console.log(`фильтр attributes.rating>=4: ${f3.status} hits=${JSON.stringify(f3.body?.hits?.map((h) => h.id))}`)

  // 4. Boolean по динамическому полю
  const f4 = await req("POST", `/indexes/${IDX}/search`, {
    q: "",
    filter: ["attributes.eco = true"],
    limit: 10,
  })
  console.log(`фильтр attributes.eco=true: ${f4.status} hits=${JSON.stringify(f4.body?.hits?.map((h) => h.id))}`)

  // 5. facetDistribution по динамическому полю (через паттерн)
  const f5 = await req("POST", `/indexes/${IDX}/search`, {
    q: "",
    facets: ["attributes.brand", "attributes.color", "attributes.eco"],
    limit: 0,
  })
  console.log(`facetDistribution по динамическим полям: ${JSON.stringify(f5.body?.facetDistribution)}`)

  // 6. facetStats по динамическому числовому полю
  const f6 = await req("POST", `/indexes/${IDX}/search`, {
    q: "",
    facets: ["attributes.rating", "price"],
    limit: 0,
  })
  console.log(`facetStats (rating, price): ${JSON.stringify(f6.body?.facetStats)}`)

  // 7. Поиск по вложенному значению атрибута (searchableAttributes: attributes)
  const f7 = await req("POST", `/indexes/${IDX}/search`, { q: "deepsea", limit: 10 })
  console.log(`поиск q=deepsea (значение атрибута): ${JSON.stringify(f7.body?.hits?.map((h) => h.id))}`)

  // 8. IN по массиву значений одного атрибута (multi-select)
  const f8 = await req("POST", `/indexes/${IDX}/search`, {
    q: "",
    filter: ['attributes.brand IN ["medusa", "deepsea"]'],
    limit: 10,
  })
  console.log(`фильтр attributes.brand IN [...]: ${f8.status} hits=${f8.body?.hits?.length}`)

  const d = await req("DELETE", `/indexes/${IDX}`)
  if (d.body?.taskUid) await wait(d.body.taskUid)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
