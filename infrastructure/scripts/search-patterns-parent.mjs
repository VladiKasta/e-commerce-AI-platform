#!/usr/bin/env node
// Проверка варианта: родительский объект "attributes" в filterableAttributes.
const HOST = "http://meilisearch:7700"
const KEY = process.env.MEILISEARCH_MASTER_KEY
const IDX = "probe_patterns2"
const H = { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" }
async function req(method, path, body) {
  const r = await fetch(`${HOST}${path}`, { method, headers: H, body: body ? JSON.stringify(body) : undefined })
  const t = await r.text(); let b = null; try { b = t ? JSON.parse(t) : null } catch { b = t }
  return { status: r.status, body: b }
}
async function wait(uid) { for (let i = 0; i < 200; i++) { const { body } = await req("GET", `/tasks/${uid}`); if (body?.status && !["enqueued","processing"].includes(body.status)) return body; await new Promise(r=>setTimeout(r,100)) } throw new Error("timeout") }
const main = async () => {
  const d = await req("DELETE", `/indexes/${IDX}`); if (d.body?.taskUid) await wait(d.body.taskUid)
  const c = await req("POST", "/indexes", { uid: IDX, primaryKey: "id" }); await wait(c.body.taskUid)
  const s = await req("PATCH", `/indexes/${IDX}/settings`, {
    distinctAttribute: "product_id",
    searchableAttributes: ["title", "sku", "attributes"],
    filterableAttributes: ["product_id", "price", "in_stock", "attributes"],
    sortableAttributes: ["price"],
  })
  const st = await wait(s.body.taskUid)
  console.log(`filterable=[..., "attributes"] (родитель): ${st.status}`, st.error ? JSON.stringify(st.error) : "")
  const a = await req("POST", `/indexes/${IDX}/documents`, [
    { id: "v1", product_id: "p1", title: "Футболка", sku: "TEE-1", price: 1490, in_stock: true, attributes: { brand: "medusa", color: "black", rating: 4.5, eco: true } },
    { id: "v2", product_id: "p2", title: "Кружка", sku: "MUG-1", price: 790, in_stock: true, attributes: { brand: "deepsea", color: "white", rating: 3.0, eco: false } },
  ])
  await wait(a.body.taskUid)
  for (const [label, filter] of [
    ["brand=medusa", ['attributes.brand = "medusa"']],
    ["rating>=4", ["attributes.rating >= 4"]],
    ["eco=true", ["attributes.eco = true"]],
  ]) {
    const f = await req("POST", `/indexes/${IDX}/search`, { q: "", filter, limit: 10 })
    console.log(`${label}: ${f.status} ${f.status !== 200 ? JSON.stringify(f.body).slice(0, 260) : JSON.stringify(f.body.hits.map(h => h.id))}`)
  }
  const fa = await req("POST", `/indexes/${IDX}/search`, { q: "", facets: ["attributes.brand", "attributes.color"], limit: 0 })
  console.log(`facets: ${fa.status} ${JSON.stringify(fa.body?.facetDistribution ?? fa.body).slice(0, 300)}`)
  const fs = await req("POST", `/indexes/${IDX}/search`, { q: "", facets: ["attributes.rating"], limit: 0 })
  console.log(`facetStats.rating: ${JSON.stringify(fs.body?.facetStats)}`)
  const dd = await req("DELETE", `/indexes/${IDX}`); if (dd.body?.taskUid) await wait(dd.body.taskUid)
}
main().catch(e => { console.error(e); process.exit(1) })
