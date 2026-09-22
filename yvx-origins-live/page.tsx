"use client";

import { useEffect, useMemo, useState } from "react";

type Row = {
  id: string;
  sku: string;
  productId: string;
  product: string;
  size: string;
  status: string;
  state: "sold" | "reserved" | "inactive" | "on_hand";
  warehouse: string;
  subLocation: string;
  sellPrice: number;
  soldPrice: number;
  soldAt: string | null;
  updatedAt: string | null;
  days: number | null;
};

type Product = {
  id: string;
  name: string;
  rows: Row[];
  available: number;
  sold: number;
  lowSizes: string[];
  lastSold: string | null;
};

function isOnHand(row: Row) {
  return row.state === "on_hand";
}

function isSold(row: Row) {
  return row.state === "sold" || Boolean(row.soldAt);
}

function stateLabel(row: Row) {
  if (isSold(row)) return "Sold";
  if (row.state === "reserved") return "Reserved";
  if (row.state === "inactive") return "Inactive";
  return "On hand";
}

function money(n: number) {
  return new Intl.NumberFormat("en-US", { style:"currency", currency:"USD", maximumFractionDigits:0 }).format(n || 0);
}

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-US", { month:"short", day:"numeric", year:"numeric" }).format(new Date(value));
}

export default function Page() {
  const [rows, setRows] = useState<Row[]>([]);
  const [source, setSource] = useState<"loading"|"stackknack"|"unavailable">("loading");
  const [error, setError] = useState("");
  const [updated, setUpdated] = useState<string>(new Date().toISOString());
  const [query, setQuery] = useState("");
  const [warehouse, setWarehouse] = useState("All Locations");
  const [stockFilter, setStockFilter] = useState("All Inventory");
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function refresh() {
    setLoading(true);
    try {
      const res = await fetch("/api/inventory", { cache:"no-store" });
      const data = await res.json();
      if (res.ok && Array.isArray(data.rows)) {
        setRows(data.rows);
        setSource("stackknack");
        setError("");
        setUpdated(data.fetchedAt || new Date().toISOString());
      } else {
        setRows([]);
        setSource("unavailable");
        setError(data?.error || "StackKnack inventory could not be loaded.");
      }
    } catch (err) {
      setRows([]);
      setSource("unavailable");
      setError(err instanceof Error ? err.message : "StackKnack inventory could not be loaded.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { refresh(); }, []);

  const warehouses = useMemo(() => ["All Locations", ...Array.from(new Set(rows.map(r => r.warehouse))).sort()], [rows]);

  const products = useMemo<Product[]>(() => {
    const grouped = new Map<string, Row[]>();
    for (const row of rows) {
      if (warehouse !== "All Locations" && row.warehouse !== warehouse) continue;
      const hay = `${row.product} ${row.sku} ${row.size}`.toLowerCase();
      if (query && !hay.includes(query.toLowerCase())) continue;
      const arr = grouped.get(row.productId) || [];
      arr.push(row);
      grouped.set(row.productId, arr);
    }
    return Array.from(grouped.entries()).map(([id, itemRows]) => {
      const live = itemRows.filter(isOnHand);
      const sold = itemRows.filter(isSold);
      const sizes = Array.from(new Set(itemRows.map(r => r.size)));
      const lowSizes = sizes.filter(size => live.filter(r => r.size === size).length < 2);
      const soldDates = sold.map(r => r.soldAt).filter(Boolean) as string[];
      return {
        id,
        name: itemRows[0]?.product || "Product",
        rows: itemRows,
        available: live.length,
        sold: sold.length,
        lowSizes,
        lastSold: soldDates.sort().at(-1) || null,
      };
    }).filter(p => {
      if (stockFilter === "Low Stock") return p.lowSizes.length > 0;
      if (stockFilter === "Sold Out") return p.available === 0;
      if (stockFilter === "In Stock") return p.available > 0;
      return true;
    }).sort((a,b) => a.name.localeCompare(b.name));
  }, [rows, warehouse, query, stockFilter]);

  const scopedRows = warehouse === "All Locations" ? rows : rows.filter(r => r.warehouse === warehouse);
  const liveRows = scopedRows.filter(isOnHand);
  const soldRows = scopedRows.filter(isSold);
  const revenue = soldRows.reduce((sum,r) => sum + (r.soldPrice || 0), 0);
  const uniqueProducts = new Set(liveRows.map(r => r.productId)).size;
  const lowCount = products.filter(p => p.lowSizes.length > 0).length;
  const selectedProduct = products.find(p => p.id === selected) || null;

  const originsWarehouse = useMemo(() => {
    const names = Array.from(new Set(rows.map(r => r.warehouse)));
    return names.find(name => /origins/i.test(name)) || names[0] || "All Locations";
  }, [rows]);

  const restock = useMemo(() => {
    const result: { product:string; size:string; current:number; needed:number }[] = [];
    const allSizes = new Map<string, Row[]>();
    rows.forEach(r => {
      const key = `${r.productId}|${r.size}`;
      const arr = allSizes.get(key) || [];
      arr.push(r);
      allSizes.set(key, arr);
    });
    allSizes.forEach(items => {
      const current = items.filter(r => r.warehouse === originsWarehouse && isOnHand(r)).length;
      if (current < 2) result.push({ product:items[0].product, size:items[0].size, current, needed:2-current });
    });
    return result.sort((a,b) => a.product.localeCompare(b.product) || a.size.localeCompare(b.size));
  }, [rows, originsWarehouse]);

  return (
    <main>
      <header className="topbar">
        <div className="brand"><span className="mark">YVX</span><span>Origins Inventory</span></div>
        <div className="sync"><span className={`dot ${source}`}></span>{source === "stackknack" ? "Live StackKnack" : source === "loading" ? "Connecting to StackKnack…" : "StackKnack not connected"}</div>
      </header>

      <section className="hero shell">
        <div>
          <p className="eyebrow">YVX × ORIGINS</p>
          <h1>Inventory, without the noise.</h1>
          <p className="sub">Live size-level inventory, sales movement, and restock needs in one clean view.</p>
        </div>
        <button className="refresh" onClick={refresh} disabled={loading}>{loading ? "Refreshing…" : "Refresh inventory"}</button>
      </section>

      <section className="stats shell">
        <article><span>Units on hand</span><strong>{liveRows.length}</strong><small>Across selected inventory</small></article>
        <article><span>Active styles</span><strong>{uniqueProducts}</strong><small>YVX products in stock</small></article>
        <article><span>Needs restock</span><strong>{lowCount}</strong><small>Styles with a size below 2</small></article>
        <article><span>Recorded sales</span><strong>{money(revenue)}</strong><small>{soldRows.length} sold inventory records</small></article>
      </section>

      <section className="panel shell">
        <div className="panelHead">
          <div><h2>Products</h2><p>Click a product to see sizes, locations, and sales history.</p></div>
          <div className="updated">Updated {new Intl.DateTimeFormat("en-US", { hour:"numeric", minute:"2-digit" }).format(new Date(updated))}</div>
        </div>
        <div className="controls">
          <div className="search"><span>⌕</span><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search product, SKU or size" /></div>
          <select value={warehouse} onChange={e=>setWarehouse(e.target.value)}>{warehouses.map(w => <option key={w}>{w}</option>)}</select>
          <select value={stockFilter} onChange={e=>setStockFilter(e.target.value)}><option>All Inventory</option><option>In Stock</option><option>Low Stock</option><option>Sold Out</option></select>
        </div>
        <div className="tableWrap">
          <div className="thead"><span>Product</span><span>Available</span><span>Sold</span><span>Last sold</span><span>Status</span><span></span></div>
          {products.map(p => <button className="row" key={p.id} onClick={()=>setSelected(p.id)}>
            <span><b>{p.name}</b><small>{Array.from(new Set(p.rows.map(r=>r.size))).join(" · ")}</small></span>
            <span className="number">{p.available}</span>
            <span className="number muted">{p.sold}</span>
            <span>{formatDate(p.lastSold)}</span>
            <span>{p.available === 0 ? <em className="pill sold">Sold out</em> : p.lowSizes.length ? <em className="pill low">Low stock</em> : <em className="pill good">Healthy</em>}</span>
            <span className="arrow">›</span>
          </button>)}
          {!products.length && <div className="empty">{source === "loading" ? "Loading live StackKnack inventory…" : source === "unavailable" ? `Live inventory unavailable${error ? `: ${error}` : "."}` : "No products match these filters."}</div>}
        </div>
      </section>

      <section className="grid shell">
        <article className="panel compact">
          <div className="panelHead"><div><h2>Origins restock ticket</h2><p>{originsWarehouse} · every known size below 2 available units.</p></div><span className="badge">AUTO</span></div>
          <div className="restock">
            {restock.slice(0,8).map((r,i)=><div key={`${r.product}-${r.size}-${i}`}><span><b>{r.product}</b><small>Size {r.size} · {r.current} currently</small></span><strong>+{r.needed}</strong></div>)}
            {!restock.length && <div className="empty small">No restock needed.</div>}
          </div>
        </article>
        <article className="panel compact">
          <div className="panelHead"><div><h2>Recent movement</h2><p>Latest sold or updated inventory.</p></div></div>
          <div className="activity">
            {[...rows].sort((a,b)=>new Date(b.updatedAt||0).getTime()-new Date(a.updatedAt||0).getTime()).slice(0,6).map(r=><div key={r.id}><span className="activityDot"></span><span><b>{r.product}</b><small>{r.size} · {r.warehouse}</small></span><time>{isSold(r) ? "Sold" : "Updated"}</time></div>)}
          </div>
        </article>
      </section>

      {selectedProduct && <div className="overlay" onClick={()=>setSelected(null)}><aside className="drawer" onClick={e=>e.stopPropagation()}>
        <button className="close" onClick={()=>setSelected(null)}>×</button>
        <p className="eyebrow">PRODUCT DETAIL</p><h2>{selectedProduct.name}</h2>
        <div className="detailStats"><div><span>Available</span><strong>{selectedProduct.available}</strong></div><div><span>Sold records</span><strong>{selectedProduct.sold}</strong></div><div><span>Last sold</span><strong>{formatDate(selectedProduct.lastSold)}</strong></div></div>
        <h3>Inventory by size</h3>
        <div className="sizeList">{Array.from(new Set(selectedProduct.rows.map(r=>r.size))).map(size=>{
          const sizeRows=selectedProduct.rows.filter(r=>r.size===size); const live=sizeRows.filter(isOnHand);
          return <div key={size}><span className="sizeBox">{size}</span><span><b>{live.length} available</b><small>{Array.from(new Set(live.map(r=>r.warehouse))).join(" · ") || "No live inventory"}</small></span><span className={live.length<2?"warn":"ok"}>{live.length<2?`Need ${2-live.length}`:"Healthy"}</span></div>
        })}</div>
        <h3>Inventory records</h3>
        <div className="records">{selectedProduct.rows.map(r=><div key={r.id}><span><b>{r.size}</b><small>{r.sku || "No SKU"}</small></span><span>{r.warehouse}<small>{r.subLocation}</small></span><span><b>{stateLabel(r)}</b><small>{r.soldAt?formatDate(r.soldAt):money(r.sellPrice)}</small></span></div>)}</div>
      </aside></div>}
    </main>
  );
}
