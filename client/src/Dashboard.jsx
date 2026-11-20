import React, { useEffect, useMemo, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import {
  ArrowDown,
  ArrowUp,
  Banknote,
  ChevronRight,
  Receipt,
  Scale,
  ShoppingCart,
  Truck,
  Wallet,
} from "lucide-react";
import { fetchStats } from "./store/dataSlice";

// =====================================================
// Dashboard: KPI cards, area / bar / donut charts (plain SVG, no chart library)
// Reads the data the app already caches in Redux.
// =====================================================

const BUSINESSES = ["DDGS", "Maize and Turmeric"];
const RANGES = [3, 6, 12];
const PALETTE = ["#38bdf8", "#2f5f8f", "#b3c5d3", "#7fd6f4"];
const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

const inr2 = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 2,
});
const inr0 = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});
const qtyFmt = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 3 });

const money = (v) => inr2.format(Number(v || 0));
const qty = (v) => qtyFmt.format(Number(v || 0));

// ₹1.2L, ₹3.4Cr ... for chart axes and small pills
function compact(v) {
  const n = Math.abs(Number(v || 0));
  const s = v < 0 ? "-" : "";
  if (n >= 1e7) return `${s}₹${(n / 1e7).toFixed(n >= 1e8 ? 0 : 1)}Cr`;
  if (n >= 1e5) return `${s}₹${(n / 1e5).toFixed(1)}L`;
  if (n >= 1e3) return `${s}₹${(n / 1e3).toFixed(0)}K`;
  return `${s}₹${Math.round(n)}`;
}

const compactQty = (v) =>
  v >= 1000
    ? `${(v / 1000).toFixed(v % 1000 ? 1 : 0)}K`
    : String(Math.round(v));

const dayOf = (v) => String(v || "").slice(0, 10);

function monthKeys(n) {
  const now = new Date();
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    out.push({
      key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
      label: `${MONTHS[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`,
    });
  }
  return out;
}

const pctChange = (cur, prev) =>
  prev > 0 ? ((cur - prev) / prev) * 100 : null;

function niceCeil(v) {
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const m = v / p;
  const n = m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10;
  return n * p;
}

function smoothPath(pts) {
  return pts
    .map((p, i) => {
      if (i === 0) return `M${p[0]},${p[1]}`;
      const q = pts[i - 1];
      const cx = (q[0] + p[0]) / 2;
      return `C${cx},${q[1]} ${cx},${p[1]} ${p[0]},${p[1]}`;
    })
    .join(" ");
}

// top 3 companies + "Others", for the donut charts
function breakdown(map, companyMap) {
  const all = Object.entries(map)
    .map(([id, value]) => ({ name: companyMap[id] || "Unknown", value }))
    .filter((x) => x.value > 0)
    .sort((a, b) => b.value - a.value);

  const total = all.reduce((t, x) => t + x.value, 0);
  const items = all.slice(0, 3).map((x) => ({ ...x }));
  const rest = all.slice(3).reduce((t, x) => t + x.value, 0);
  if (rest > 0) items.push({ name: "Others", value: rest });
  items.forEach((it, i) => {
    it.color = PALETTE[i];
  });

  return { items, total, all };
}

// =====================================================
// Small chart components
// =====================================================

function AreaChart({ id, labels, values, color }) {
  const [hover, setHover] = useState(null);

  const W = 440;
  const H = 220;
  const L = 46;
  const R = 12;
  const T = 14;
  const B = 28;

  const top = niceCeil(Math.max(...values, 1));
  const x = (i) =>
    L +
    (values.length > 1
      ? (i * (W - L - R)) / (values.length - 1)
      : (W - L - R) / 2);
  const y = (v) => T + (H - T - B) * (1 - v / top);

  const pts = values.map((v, i) => [x(i), y(v)]);
  const line = smoothPath(pts);
  const area = `${line} L${x(values.length - 1)},${H - B} L${x(0)},${H - B} Z`;
  const ticks = [0, 1, 2, 3, 4].map((i) => (top * i) / 4);
  const step = Math.ceil(labels.length / 6);

  function onMove(e) {
    const r = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    let best = 0;
    pts.forEach((p, i) => {
      if (Math.abs(p[0] - px) < Math.abs(pts[best][0] - px)) best = i;
    });
    setHover(best);
  }

  const tw = 128;
  const th = 44;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="dash-svg"
      onMouseMove={onMove}
      onMouseLeave={() => setHover(null)}
    >
      <defs>
        <linearGradient id={`${id}-g`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.28" />
          <stop offset="100%" stopColor={color} stopOpacity="0.02" />
        </linearGradient>
      </defs>

      {ticks.map((t) => (
        <g key={t}>
          <line
            x1={L}
            x2={W - R}
            y1={y(t)}
            y2={y(t)}
            stroke="#e8eef5"
            strokeWidth="1"
          />
          <text
            x={L - 8}
            y={y(t) + 3}
            textAnchor="end"
            fontSize="9.5"
            fill="#8a97aa"
          >
            {compact(t)}
          </text>
        </g>
      ))}

      {labels.map((lb, i) =>
        i % step === 0 || i === labels.length - 1 ? (
          <text
            key={lb}
            x={x(i)}
            y={H - 8}
            textAnchor="middle"
            fontSize="9.5"
            fill="#8a97aa"
          >
            {lb}
          </text>
        ) : null,
      )}

      <path d={area} fill={`url(#${id}-g)`} />
      <path
        d={line}
        fill="none"
        stroke={color}
        strokeWidth="2.2"
        strokeLinecap="round"
      />

      {hover !== null && (
        <g>
          <line
            x1={pts[hover][0]}
            x2={pts[hover][0]}
            y1={T}
            y2={H - B}
            stroke={color}
            strokeDasharray="3 3"
            opacity="0.55"
          />
          <circle
            cx={pts[hover][0]}
            cy={pts[hover][1]}
            r="4.5"
            fill={color}
            stroke="#fff"
            strokeWidth="2"
          />
          {(() => {
            const tx = Math.min(
              Math.max(pts[hover][0] - tw / 2, L),
              W - R - tw,
            );
            const ty =
              pts[hover][1] - th - 12 < T
                ? pts[hover][1] + 12
                : pts[hover][1] - th - 12;
            return (
              <g>
                <rect
                  x={tx}
                  y={ty}
                  width={tw}
                  height={th}
                  rx="10"
                  fill="#4b7ca6"
                />
                <text x={tx + 11} y={ty + 17} fontSize="10" fill="#cfe4f5">
                  {labels[hover]}
                </text>
                <text
                  x={tx + 11}
                  y={ty + 35}
                  fontSize="13"
                  fontWeight="700"
                  fill="#fff"
                >
                  {inr0.format(values[hover])}
                </text>
              </g>
            );
          })()}
        </g>
      )}
    </svg>
  );
}

function BarChart({ id, labels, values }) {
  const W = 360;
  const H = 220;
  const L = 38;
  const R = 8;
  const T = 12;
  const B = 28;

  const top = niceCeil(Math.max(...values, 1));
  const slot = (W - L - R) / values.length;
  const bw = Math.min(slot * 0.62, 26);
  const y = (v) => T + (H - T - B) * (1 - v / top);
  const ticks = [0, 1, 2, 3, 4].map((i) => (top * i) / 4);
  const step = Math.ceil(labels.length / 6);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="dash-svg">
      <defs>
        <linearGradient id={`${id}-g`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#8fdcf5" />
          <stop offset="100%" stopColor="#3aa8d3" />
        </linearGradient>
      </defs>

      {ticks.map((t) => (
        <g key={t}>
          <line
            x1={L}
            x2={W - R}
            y1={y(t)}
            y2={y(t)}
            stroke="#e8eef5"
            strokeWidth="1"
          />
          <text
            x={L - 7}
            y={y(t) + 3}
            textAnchor="end"
            fontSize="9.5"
            fill="#8a97aa"
          >
            {compactQty(t)}
          </text>
        </g>
      ))}

      {values.map((v, i) => {
        const bx = L + slot * i + (slot - bw) / 2;
        const h = Math.max((H - T - B) * (v / top), v > 0 ? 2 : 0);
        return (
          <g key={labels[i]}>
            <rect
              x={bx}
              y={H - B - h}
              width={bw}
              height={h}
              rx="5"
              fill={`url(#${id}-g)`}
            >
              <title>{`${labels[i]}: ${qty(v)} qtl`}</title>
            </rect>
            {(i % step === 0 || i === labels.length - 1) && (
              <text
                x={bx + bw / 2}
                y={H - 8}
                textAnchor="middle"
                fontSize="9.5"
                fill="#8a97aa"
              >
                {labels[i]}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

function Donut({ items, total, caption }) {
  const r = 68;
  const c = 2 * Math.PI * r;
  let acc = 0;

  return (
    <svg viewBox="0 0 200 200" className="dash-donut">
      <circle
        cx="100"
        cy="100"
        r={r}
        fill="none"
        stroke="#eef3f8"
        strokeWidth="26"
      />

      {items.map((it) => {
        const len = total > 0 ? (it.value / total) * c : 0;
        const draw = Math.max(len - 2, 0);
        const seg = (
          <circle
            key={it.name}
            cx="100"
            cy="100"
            r={r}
            fill="none"
            stroke={it.color}
            strokeWidth="26"
            strokeDasharray={`${draw} ${c - draw}`}
            strokeDashoffset={-acc}
            transform="rotate(-90 100 100)"
          />
        );
        acc += len;
        return seg;
      })}

      <text
        x="100"
        y="98"
        textAnchor="middle"
        fontSize="17"
        fontWeight="800"
        fill="#172033"
      >
        {compact(total)}
      </text>
      <text x="100" y="115" textAnchor="middle" fontSize="9" fill="#8792a5">
        {caption}
      </text>
    </svg>
  );
}

// =====================================================
// Layout pieces
// =====================================================

function Delta({ value, invert = false }) {
  if (value == null) return null;
  const up = value >= 0;
  const good = invert ? !up : up;
  return (
    <span className={`dash-delta ${good ? "good" : "bad"}`}>
      {up ? <ArrowUp size={11} /> : <ArrowDown size={11} />}
      {Math.abs(value).toFixed(1)}%
    </span>
  );
}

function Card({ title, onOpen, children, className = "" }) {
  return (
    <section className={`dash-card ${className}`}>
      <header>
        <h4>{title}</h4>
        {onOpen && (
          <button
            type="button"
            className="dash-chev"
            onClick={onOpen}
            aria-label={`Open ${title}`}
          >
            <ChevronRight size={14} />
          </button>
        )}
      </header>
      {children}
    </section>
  );
}

function Kpi({ icon: Icon, tone, label, value, sub, delta, invert, onGo }) {
  return (
    <div className="dash-kpi">
      <div className={`dash-kpi-icon ${tone}`}>
        <Icon size={17} />
      </div>
      <span className="dash-kpi-label">{label}</span>
      <strong>{value}</strong>
      <div className="dash-kpi-foot">
        {delta != null && <Delta value={delta} invert={invert} />}
        <small>{sub}</small>
        {onGo && (
          <button
            type="button"
            className="dash-chev kpi-go"
            onClick={onGo}
            aria-label={`Open ${label}`}
          >
            <ChevronRight size={14} />
          </button>
        )}
      </div>
    </div>
  );
}

function Legend({ items, total, format = compact }) {
  return (
    <ul className="dash-legend">
      {items.map((it) => (
        <li key={it.name}>
          <i style={{ background: it.color }} />
          <div>
            <b>
              {it.name} ({total > 0 ? ((it.value / total) * 100).toFixed(1) : 0}
              %)
            </b>
            <small>{format(it.value)}</small>
          </div>
        </li>
      ))}
    </ul>
  );
}

// =====================================================
// MAIN
// =====================================================

export default function Dashboard({ api, canSeeFinance, companyMap, onOpen }) {
  const dispatch = useDispatch();
  const data = useSelector((s) => s.data);

  const [sel, setSel] = useState(""); // "" = all businesses
  const [months, setMonths] = useState(12);
  const [duesTab, setDuesTab] = useState("receive");

  // exact all-time totals come from the server, per selected business
  useEffect(() => {
    dispatch(fetchStats({ api, business: sel }));
  }, [sel, api, dispatch]);

  const holder = sel === data.business ? data : data.cache[sel];
  const stats = holder?.stats;

  const view = useMemo(() => {
    const names = sel ? [sel] : BUSINESSES;
    const items = (page) =>
      names.flatMap((n) => {
        const h = n === data.business ? data : data.cache[n];
        return h?.lists?.[page]?.items || [];
      });

    const purchases = items("Purchases");
    const sales = items("Sales");
    const payments = items("Payments");

    const keys = monthKeys(months);
    const at = Object.fromEntries(keys.map((k, i) => [k.key, i]));

    const salesTotal = keys.map(() => 0);
    const purchaseTotal = keys.map(() => 0);
    const qtySold = keys.map(() => 0);
    const qtyBought = keys.map(() => 0);
    const bySale = {};
    const byPurchase = {};

    sales.forEach((r) => {
      const i = at[dayOf(r.entry_date).slice(0, 7)];
      if (i === undefined) return;
      const t = Number(r.gross_total || 0);
      salesTotal[i] += t;
      qtySold[i] += Number(r.quantity || 0);
      bySale[r.company_id] = (bySale[r.company_id] || 0) + t;
    });

    purchases.forEach((r) => {
      const i = at[dayOf(r.entry_date).slice(0, 7)];
      if (i === undefined) return;
      const t = Number(r.purchase_total || 0);
      purchaseTotal[i] += t;
      qtyBought[i] += Number(r.quantity || 0);
      byPurchase[r.company_id] = (byPurchase[r.company_id] || 0) + t;
    });

    // outstanding balance per company (all records, not only the range)
    const co = {};
    const row = (id) =>
      (co[id] = co[id] || { sales: 0, received: 0, purchases: 0, paid: 0 });
    sales.forEach((r) => {
      row(r.company_id).sales += Number(r.gross_total || 0);
    });
    purchases.forEach((r) => {
      row(r.company_id).purchases += Number(r.purchase_total || 0);
    });
    payments.forEach((r) => {
      const c = row(r.company_id);
      if (r.direction === "received") c.received += Number(r.amount || 0);
      if (r.direction === "paid") c.paid += Number(r.amount || 0);
    });

    const nets = Object.entries(co).map(([id, c]) => ({
      name: companyMap[id] || "Unknown",
      net: c.sales - c.received - (c.purchases - c.paid),
    }));
    const toReceive = nets
      .filter((c) => c.net > 0.5)
      .map((c) => ({ name: c.name, amount: c.net }))
      .sort((a, b) => b.amount - a.amount);
    const toPay = nets
      .filter((c) => c.net < -0.5)
      .map((c) => ({ name: c.name, amount: -c.net }))
      .sort((a, b) => b.amount - a.amount);

    const pending = sales.filter((r) => Number(r.unload_quantity || 0) <= 0);

    const last = keys.length - 1;

    return {
      keys,
      salesTotal,
      purchaseTotal,
      qtySold,
      qtyBought,
      sellers: breakdown(bySale, companyMap),
      suppliers: breakdown(byPurchase, companyMap),
      toReceive,
      toPay,
      pendingCount: pending.length,
      pendingQty: pending.reduce((t, r) => t + Number(r.quantity || 0), 0),
      curSales: salesTotal[last],
      prevSales: salesTotal[last - 1],
      curPurchases: purchaseTotal[last],
      prevPurchases: purchaseTotal[last - 1],
      soldInRange: qtySold.reduce((t, v) => t + v, 0),
      boughtInRange: qtyBought.reduce((t, v) => t + v, 0),
      hasAny: sales.length + purchases.length > 0,
    };
  }, [data, sel, months, companyMap]);

  const labels = view.keys.map((k) => k.label);
  const salesDelta = pctChange(view.curSales, view.prevSales);
  const purchDelta = pctChange(view.curPurchases, view.prevPurchases);

  const dueList = duesTab === "receive" ? view.toReceive : view.toPay;

  return (
    <div className="dash">
      {/* HEADER */}
      <div className="dash-head">
        <div>
          <span className="dash-eyebrow">
            Total sales · {sel || "All businesses"}
          </span>
          <div className="dash-hero">
            <strong>{money(stats?.sales)}</strong>
            {salesDelta != null && (
              <span
                className={`dash-hero-badge ${salesDelta >= 0 ? "good" : "bad"}`}
              >
                {Math.abs(salesDelta).toFixed(1)}%{" "}
                {salesDelta >= 0 ? (
                  <ArrowUp size={13} />
                ) : (
                  <ArrowDown size={13} />
                )}
              </span>
            )}
          </div>
          <p className="dash-sub">
            This month {money(view.curSales)} · Prev. month{" "}
            {money(view.prevSales)}
          </p>
        </div>

        <div className="dash-controls">
          <div className="dash-seg" role="tablist" aria-label="Business">
            {["", ...BUSINESSES].map((b) => (
              <button
                key={b || "all"}
                type="button"
                role="tab"
                aria-selected={sel === b}
                className={sel === b ? "on" : ""}
                onClick={() => setSel(b)}
              >
                {b || "All"}
              </button>
            ))}
          </div>

          <select
            className="dash-select"
            value={months}
            onChange={(e) => setMonths(Number(e.target.value))}
            aria-label="Chart range"
          >
            {RANGES.map((m) => (
              <option key={m} value={m}>
                Last {m} months
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="dash-grid">
        {/* LEFT: KPIs + charts */}
        <div className="dash-main">
          <div className="dash-kpis">
            <Kpi
              icon={ShoppingCart}
              tone="violet"
              label="Total purchases"
              value={money(stats?.purchases)}
              delta={purchDelta}
              invert
              sub="vs last month"
              onGo={() => onOpen("Vehicle Tracking", sel)}
            />

            {canSeeFinance ? (
              <>
                <Kpi
                  icon={Receipt}
                  tone="green"
                  label="Payments received"
                  value={money(stats?.collected)}
                  sub={`Receivable ${compact(stats?.receivable)}`}
                  onGo={() => onOpen("Ledger", sel)}
                />
                <Kpi
                  icon={Banknote}
                  tone="amber"
                  label="Payments paid"
                  value={money(stats?.disbursed)}
                  sub={`Payable ${compact(stats?.payable)}`}
                  onGo={() => onOpen("Dues", sel)}
                />
                <Kpi
                  icon={Wallet}
                  tone="sky"
                  label="Net cash position"
                  value={money(stats?.net)}
                  sub="Received − paid"
                  onGo={() => onOpen("Ledger", sel)}
                />
              </>
            ) : (
              <>
                <Kpi
                  icon={Scale}
                  tone="green"
                  label="Quantity sold"
                  value={`${qty(view.soldInRange)} qtl`}
                  sub={`Last ${months} months`}
                />
                <Kpi
                  icon={Scale}
                  tone="amber"
                  label="Quantity bought"
                  value={`${qty(view.boughtInRange)} qtl`}
                  sub={`Last ${months} months`}
                />
                <Kpi
                  icon={Truck}
                  tone="sky"
                  label="Pending unloads"
                  value={view.pendingCount}
                  sub={`${qty(view.pendingQty)} qtl waiting`}
                  onGo={() => onOpen("Unloads", sel)}
                />
              </>
            )}
          </div>

          <div className="dash-pair">
            <Card
              title="Sales overview"
              onOpen={canSeeFinance ? () => onOpen("Ledger", sel) : undefined}
            >
              <AreaChart
                id="sales"
                labels={labels}
                values={view.salesTotal}
                color="#1f9d7a"
              />
            </Card>

            <Card
              title="Purchase overview"
              onOpen={() => onOpen("Vehicle Tracking", sel)}
            >
              <AreaChart
                id="purch"
                labels={labels}
                values={view.purchaseTotal}
                color="#f08a3c"
              />
            </Card>
          </div>

          <div className="dash-pair">
            <Card title="Sales by customer">
              {view.sellers.total > 0 ? (
                <div className="dash-donut-row">
                  <Legend
                    items={view.sellers.items}
                    total={view.sellers.total}
                  />
                  <Donut
                    items={view.sellers.items}
                    total={view.sellers.total}
                    caption="Total sales"
                  />
                </div>
              ) : (
                <p className="dash-empty">No sales in this period.</p>
              )}
            </Card>

            <Card title="Purchases by supplier">
              {view.suppliers.total > 0 ? (
                <div className="dash-donut-row">
                  <Legend
                    items={view.suppliers.items}
                    total={view.suppliers.total}
                  />
                  <Donut
                    items={view.suppliers.items}
                    total={view.suppliers.total}
                    caption="Total purchases"
                  />
                </div>
              ) : (
                <p className="dash-empty">No purchases in this period.</p>
              )}
            </Card>
          </div>
        </div>

        {/* RIGHT: bars + ranked lists */}
        <div className="dash-side">
          <Card title="Quantity sold (qtl)">
            <BarChart id="qty" labels={labels} values={view.qtySold} />
          </Card>

          <Card title="Top customers">
            {view.sellers.all.length ? (
              <ul className="dash-list">
                {view.sellers.all.slice(0, 4).map((c) => (
                  <li key={c.name}>
                    <div>
                      <b>{c.name}</b>
                      <small>
                        {((c.value / view.sellers.total) * 100).toFixed(1)}% of
                        sales
                      </small>
                    </div>
                    <span className="dash-pill green">{compact(c.value)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="dash-empty">No sales in this period.</p>
            )}
          </Card>

          {canSeeFinance && (
            <Card title="Outstanding dues" onOpen={() => onOpen("Dues", sel)}>
              <div className="dash-seg small">
                <button
                  type="button"
                  className={duesTab === "receive" ? "on" : ""}
                  onClick={() => setDuesTab("receive")}
                >
                  To receive
                </button>
                <button
                  type="button"
                  className={duesTab === "pay" ? "on" : ""}
                  onClick={() => setDuesTab("pay")}
                >
                  To pay
                </button>
              </div>

              {dueList.length ? (
                <ul className="dash-list">
                  {dueList.slice(0, 4).map((c) => (
                    <li key={c.name}>
                      <div>
                        <b>{c.name}</b>
                        <small>
                          {duesTab === "receive" ? "Owes you" : "You owe"}
                        </small>
                      </div>
                      <span
                        className={`dash-pill ${duesTab === "receive" ? "green" : "red"}`}
                      >
                        {compact(c.amount)}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="dash-empty">Nothing pending.</p>
              )}
            </Card>
          )}
        </div>
      </div>

      {!view.hasAny && (
        <p className="dash-note">
          Charts fill in once purchases and sales are loaded.
        </p>
      )}
    </div>
  );
}
