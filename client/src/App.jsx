
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import { useDispatch, useSelector } from "react-redux";
import {
  fetchStats,
  fetchList,
  saveRecord,
  deleteRecord,
  setFilter,
  clearFilters,
  toggleSort,
  clearError,
  clearData,
} from "./store/dataSlice";

import {
  LayoutDashboard,
  Building2,
  ShoppingCart,
  Receipt,
  Wallet,
  LogOut,
  Plus,
  RefreshCw,
  Search,
  Menu,
  Trash2,
    Edit3,
    ArrowUp,
    Scale,
  Truck,
  ArrowDown,
  X,
} from "lucide-react";

// =====================================================
// 1. ENVIRONMENT CONFIGURATION
// =====================================================

// API BASE URL
const API = (import.meta.env.VITE_API_URL || "")
  .trim()
  .replace(/\/+$/, "");

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!API) {
  console.error("VITE_API_URL is missing.");
}

if (!SUPABASE_URL || !SUPABASE_KEY) {
  throw new Error(
    "Missing Supabase configuration. Check your frontend environment variables."
  );
}

// =====================================================
// 2. SUPABASE CLIENT
// =====================================================

const auth = createClient(SUPABASE_URL, SUPABASE_KEY);

// =====================================================
// 3. NAVIGATION
// =====================================================

const nav = [
  ["Dashboard", LayoutDashboard],
  ["Companies", Building2],
  ["Purchases", ShoppingCart],
  ["Sales", Receipt],
  ["Payments", Wallet],
  ["Company Summary", Scale],
  ["Vehicle Tracking", Truck],
];

// =====================================================
// 4. HELPERS
// =====================================================

const money = (value) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(Number(value || 0));

const qty = (value) =>
  new Intl.NumberFormat("en-IN", { maximumFractionDigits: 3 }).format(
    Number(value || 0)
  );

const today = () => {
  const date = new Date();
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
};

// Which column each page is sorted/filtered by date on
const DATE_KEY = {
  Purchases: "entry_date",
  Sales: "entry_date",
  Payments: "payment_date",
};

const TOTAL_KEY = {
  Purchases: "purchase_total",
  Sales: "gross_total",
};

const SUMMARY = "Company Summary";
const TRACK = "Vehicle Tracking";

// vehicle numbers compared without spaces / dashes / case
const normVehicle = (v) => String(v || "").replace(/[\s-]/g, "").toUpperCase();

const daysBetween = (from, to) =>
  Math.round((Date.parse(dayOf(to)) - Date.parse(dayOf(from))) / 86400000);

const EMPTY_ROWS = [];
const EMPTY_FILTERS = { company: "", from: "", to: "", direction: "" };

const dayOf = (value) => String(value || "").slice(0, 10);

const getErrorMessage = (error) =>
  error?.message || "Something went wrong. Please try again.";

// =====================================================
// 5. MAIN APP
// =====================================================

export default function App() {
  const [session, setSession] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);

  const [page, setPage] = useState("Dashboard");

  // the Vehicle Tracking page adds Purchase records
  const dataPage = page === TRACK ? "Purchases" : page;

    // ---- Redux (cached data, filters, sort)
  const dispatch = useDispatch();
  const stats = useSelector((s) => s.data.stats);
  const storeError = useSelector((s) => s.data.error);
  const companies = useSelector((s) => s.data.lists.Companies.items);
  const list = useSelector((s) => s.data.lists[page]);
  const filters =
    useSelector((s) => s.data.filters[page]) || EMPTY_FILTERS;
  const sortDir =
    useSelector((s) => s.data.sortDir[page]) || "desc";

  const purchasesList = useSelector((s) => s.data.lists.Purchases);
  const salesList = useSelector((s) => s.data.lists.Sales);
  const paymentsList = useSelector((s) => s.data.lists.Payments);

  const rows = list?.items || EMPTY_ROWS;
  const firstLoad = Boolean(list?.loading && !list?.loaded);
  const refreshing = Boolean(list?.loading && list?.loaded);

  const summaryParts = [purchasesList, salesList, paymentsList];
  const summaryLoading = summaryParts.some((l) => l.loading);
  const summaryFirstLoad = summaryParts.some((l) => l.loading && !l.loaded);


  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");

  const [modal, setModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [mobile, setMobile] = useState(false);

  // Company Summary filters
  const [sCompany, setSCompany] = useState("");
  const [sFrom, setSFrom] = useState("");
  const [sTo, setSTo] = useState("");

  // Vehicle Tracking filters
  const [tPCompany, setTPCompany] = useState("");
  const [tSCompany, setTSCompany] = useState("");
  const [tFrom, setTFrom] = useState("");
  const [tTo, setTTo] = useState("");
  const [tStatus, setTStatus] = useState("");
  const [tDesc, setTDesc] = useState(true);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  // ===================================================
  // 6. AUTHENTICATION SESSION
  // ===================================================

  useEffect(() => {
    let active = true;

    const initializeAuth = async () => {
      try {
        const { data, error } = await auth.auth.getSession();

        if (error) throw error;

        if (active) {
          setSession(data.session);
        }
      } catch (err) {
        if (active) {
          setError(getErrorMessage(err));
        }
      } finally {
        if (active) {
          setAuthLoading(false);
        }
      }
    };

    initializeAuth();

    const {
      data: { subscription },
    } = auth.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
      setAuthLoading(false);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  // ===================================================
  // 7. API REQUEST HEADERS
  // ===================================================

  const headers = useCallback(async () => {
    if (!session?.access_token) {
      throw new Error("Your session has expired. Please sign in again.");
    }

    return {
      Authorization: `Bearer ${session.access_token}`,
      "Content-Type": "application/json",
    };
  }, [session]);

 // ===================================================
// 8. CENTRAL API FUNCTION
// ===================================================

const api = useCallback(
  async (path, options = {}) => {
    if (!API) {
      throw new Error(
        "VITE_API_URL is missing. Check GitHub Actions variables."
      );
    }

    const requestHeaders = await headers();

    const cleanPath = path.replace(/^\/+/, "");
    const url = `${API}/${cleanPath}`;

    let response;

    try {
      response = await fetch(url, {
        ...options,
        headers: {
          ...requestHeaders,
          ...options.headers,
        },
      });
    } catch (err) {
      console.error("API connection error:", err);

      throw new Error(
        "Cannot connect to Render backend. Check API URL and CORS."
      );
    }

    const responseText = await response.text();

    let data = null;

    if (responseText) {
      try {
        data = JSON.parse(responseText);
      } catch {
        console.error("Invalid API response:", {
          url,
          status: response.status,
          response: responseText.slice(0, 300),
        });

        throw new Error(
          `Invalid JSON response. HTTP ${response.status}. URL: ${url}`
        );
      }
    }

    if (!response.ok) {
      if (response.status === 401) {
        throw new Error(
          "Authentication failed. Please sign in again."
        );
      }

      throw new Error(
        data?.error || `API request failed (${response.status})`
      );
    }

    return data;
  },
  [headers]
);

  // ===================================================
  // 9. LOAD DATA (cached in Redux, refreshed in background)
  // ===================================================

  const refresh = useCallback(
    (force = false) => {
      if (!session) return;

      dispatch(fetchStats({ api, force }));
      dispatch(fetchList({ api, page: "Companies", force }));

      if (page === TRACK) {
        ["Purchases", "Sales"].forEach((p) =>
          dispatch(fetchList({ api, page: p, force }))
        );
      } else if (page === SUMMARY) {
        ["Purchases", "Sales", "Payments"].forEach((p) =>
          dispatch(fetchList({ api, page: p, force }))
        );
      } else if (page !== "Dashboard" && page !== "Companies") {
        dispatch(fetchList({ api, page, force }));
      }
    },
    [session, page, api, dispatch]
  );

  useEffect(() => {
    if (session) {
      refresh(false);
    } else {
      dispatch(clearData());
    }
  }, [session, page, refresh, dispatch]);

  // ===================================================
  // 10. FILTER + SORT
  // ===================================================

  const companyMap = useMemo(
    () => Object.fromEntries(companies.map((c) => [c.id, c.name])),
    [companies]
  );

  const dateKey = DATE_KEY[page];
  const hasFilters = Boolean(dateKey);

  const activeFilterCount = [
    filters.company,
    filters.from,
    filters.to,
    filters.direction,
  ].filter(Boolean).length;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();

    let out = rows.filter((record) => {
      if (
        q &&
        !`${JSON.stringify(record)} ${companyMap[record.company_id] || ""}`
          .toLowerCase()
          .includes(q)
      ) {
        return false;
      }

      if (!dateKey) return true;

      const day = dayOf(record[dateKey]);

      if (filters.company && record.company_id !== filters.company) return false;
      if (filters.from && day < filters.from) return false;
      if (filters.to && day > filters.to) return false;
      if (
        page === "Payments" &&
        filters.direction &&
        record.direction !== filters.direction
      ) {
        return false;
      }

      return true;
    });

    if (dateKey) {
      const dir = sortDir === "asc" ? 1 : -1;

      out = [...out].sort((a, b) => {
        const byDate = dayOf(a[dateKey]).localeCompare(dayOf(b[dateKey]));
        if (byDate) return byDate * dir;

        // same date: newest entry first (or last when ascending)
        return (
          String(a.created_at || a.id).localeCompare(
            String(b.created_at || b.id)
          ) * dir
        );
      });
    }

    return out;
  }, [rows, search, filters, sortDir, dateKey, page, companyMap]);

  // Totals follow the active filters and search
  const totals = useMemo(() => {
    const t = { quantity: 0, amount: 0, received: 0, paid: 0 };

    filtered.forEach((r) => {
      if (page === "Payments") {
        const amount = Number(r.amount || 0);
        if (r.direction === "received") t.received += amount;
        if (r.direction === "paid") t.paid += amount;
      } else if (TOTAL_KEY[page]) {
        t.quantity += Number(r.quantity || 0);
        t.amount += Number(r[TOTAL_KEY[page]] || 0);
      }
    });

    return t;
  }, [filtered, page]);

  // ===================================================
  // 10b. COMPANY SUMMARY (purchases, sales, payments, dues)
  // ===================================================

  const summary = useMemo(() => {
    const inRange = (value) => {
      const day = dayOf(value);
      return (!sFrom || day >= sFrom) && (!sTo || day <= sTo);
    };

    const byCompany = {};

    const entry = (id) => {
      if (!byCompany[id]) {
        byCompany[id] = {
          id,
          name: companyMap[id] || "Unknown company",
          pQty: 0, pTotal: 0, paid: 0,
          sQty: 0, sTotal: 0, received: 0,
        };
      }
      return byCompany[id];
    };

    purchasesList.items.forEach((r) => {
      if (!inRange(r.entry_date)) return;
      const c = entry(r.company_id);
      c.pQty += Number(r.quantity || 0);
      c.pTotal += Number(r.purchase_total || 0);
    });

    salesList.items.forEach((r) => {
      if (!inRange(r.entry_date)) return;
      const c = entry(r.company_id);
      c.sQty += Number(r.quantity || 0);
      c.sTotal += Number(r.gross_total || 0);
    });

    paymentsList.items.forEach((r) => {
      if (!inRange(r.payment_date)) return;
      const c = entry(r.company_id);
      if (r.direction === "paid") c.paid += Number(r.amount || 0);
      if (r.direction === "received") c.received += Number(r.amount || 0);
    });

    const q = search.trim().toLowerCase();

    const out = Object.values(byCompany)
      .filter((c) => !sCompany || c.id === sCompany)
      .filter((c) => !q || c.name.toLowerCase().includes(q))
      .map((c) => {
        const payable = c.pTotal - c.paid;
        const receivable = c.sTotal - c.received;
        return { ...c, payable, receivable, net: receivable - payable };
      })
      .sort((a, b) => a.name.localeCompare(b.name));

    const sum = (key) => out.reduce((n, c) => n + c[key], 0);

    return {
      rows: out,
      totals: {
        pQty: sum("pQty"), pTotal: sum("pTotal"), paid: sum("paid"),
        sQty: sum("sQty"), sTotal: sum("sTotal"), received: sum("received"),
        payable: sum("payable"), receivable: sum("receivable"), net: sum("net"),
      },
    };
  }, [purchasesList, salesList, paymentsList, companyMap, sCompany, sFrom, sTo, search]);

  // ===================================================
  // 10c. VEHICLE TRACKING (purchase → sale, matched by vehicle)
  // ===================================================

  const tracking = useMemo(() => {
    const purchases = purchasesList.items.map((p) => ({ ...p, _sales: [] }));

    const sales = [...salesList.items].sort((a, b) =>
      dayOf(a.entry_date).localeCompare(dayOf(b.entry_date))
    );

    const byVoucher = {};
    const byVehicle = {};

    purchases.forEach((p) => {
      const v = normVehicle(p.voucher_no);
      if (v) byVoucher[v] = p;

      const k = normVehicle(p.vehicle_number);
      if (k) (byVehicle[k] = byVehicle[k] || []).push(p);
    });

    const orphans = [];

    sales.forEach((s) => {
      // 1) explicit "purchase reference" on the sale (voucher number)
      let match = byVoucher[normVehicle(s.purchase_reference)];

      // 2) same vehicle, latest purchase on or before the sale date
      if (!match) {
        const candidates = (byVehicle[normVehicle(s.vehicle_number)] || [])
          .filter((p) => dayOf(p.entry_date) <= dayOf(s.entry_date))
          .sort((a, b) => dayOf(b.entry_date).localeCompare(dayOf(a.entry_date)));

        match = candidates.find((p) => !p._sales.length) || candidates[0];
      }

      if (match) match._sales.push(s);
      else orphans.push(s);
    });

    const all = [];

    purchases.forEach((p) => {
      if (!p._sales.length) {
        all.push({ key: `p-${p.id}`, status: "Pending", p, s: null });
      } else {
        p._sales.forEach((s) =>
          all.push({
            key: `p-${p.id}-${s.id}`,
            status: "Sold",
            p,
            s,
            single: p._sales.length === 1,
          })
        );
      }
    });

    orphans.forEach((s) =>
      all.push({ key: `s-${s.id}`, status: "No purchase", p: null, s })
    );

    const q = search.trim().toLowerCase();

    const rowsOut = all
      .filter((r) => {
        const date = dayOf((r.p || r.s).entry_date);

        if (tPCompany && r.p?.company_id !== tPCompany) return false;
        if (tSCompany && r.s?.company_id !== tSCompany) return false;
        if (tFrom && date < tFrom) return false;
        if (tTo && date > tTo) return false;
        if (tStatus && r.status !== tStatus) return false;

        if (q) {
          const text = [
            r.p?.vehicle_number,
            r.s?.vehicle_number,
            r.p?.voucher_no,
            r.s?.voucher_no,
            companyMap[r.p?.company_id],
            companyMap[r.s?.company_id],
          ]
            .join(" ")
            .toLowerCase();

          if (!text.includes(q)) return false;
        }

        return true;
      })
      .map((r) => ({
        ...r,
        days: r.p && r.s ? daysBetween(r.p.entry_date, r.s.entry_date) : null,
        margin:
          r.p && r.s && r.single
            ? Number(r.s.gross_total || 0) - Number(r.p.purchase_total || 0)
            : null,
      }))
      .sort((a, b) => {
        const da = dayOf((a.p || a.s).entry_date);
        const db = dayOf((b.p || b.s).entry_date);
        return da.localeCompare(db) * (tDesc ? -1 : 1);
      });

    // totals: each purchase counted once even if sold in several parts
    const seen = new Set();
    const totals = { pQty: 0, pTotal: 0, sQty: 0, sTotal: 0, soldPurchase: 0, pending: 0 };

    rowsOut.forEach((r) => {
      if (r.p && !seen.has(r.p.id)) {
        seen.add(r.p.id);
        totals.pQty += Number(r.p.quantity || 0);
        totals.pTotal += Number(r.p.purchase_total || 0);
        if (r.status === "Sold") totals.soldPurchase += Number(r.p.purchase_total || 0);
      }

      if (r.s) {
        totals.sQty += Number(r.s.quantity || 0);
        totals.sTotal += Number(r.s.gross_total || 0);
      }

      if (r.status === "Pending") totals.pending += 1;
    });

    totals.margin = totals.sTotal - totals.soldPurchase;

    return { rows: rowsOut, totals };
  }, [
    purchasesList, salesList, companyMap,
    tPCompany, tSCompany, tFrom, tTo, tStatus, tDesc, search,
  ]);

  const trackFiltered = Boolean(
    tPCompany || tSCompany || tFrom || tTo || tStatus || search
  );

  // ===================================================
  // 11. LOGIN
  // ===================================================

  async function login(event) {
    event.preventDefault();

    setError("");
    setBusy(true);

    try {
      const { error } = await auth.auth.signInWithPassword({
        email,
        password,
      });

      if (error) throw error;
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  // ===================================================
  // 12. LOGOUT
  // ===================================================

  async function logout() {
    setError("");

    const { error } = await auth.auth.signOut();

    if (error) {
      setError(error.message);
    }
  }

  // ===================================================
  // 13. DATABASE FORM FIELDS
  // ===================================================

  const fields = {
    Companies: [
      ["name", "Company name", "text", true],
      ["company_type", "Type", "select", true],
      ["credit_days", "Credit days", "number"],
      ["phone", "Phone", "text"],
      ["email", "Email", "email"],
      ["address", "Address", "text"],
      ["notes", "Notes", "text"],
    ],

    Purchases: [
      ["company_id", "Company", "company", true],
      ["entry_date", "Date", "date", true],
      ["voucher_no", "Voucher no.", "text"],
      ["vehicle_number", "Vehicle number", "text"],
      ["particulars", "Particulars", "text"],
      ["quantity", "Quantity (qtl)", "number"],
      ["rate", "Rate", "number"],
      ["purchase_total", "Purchase total (₹)", "number"],
      ["seller", "Seller", "text"],
      ["notes", "Notes", "text"],
    ],

    Sales: [
      ["company_id", "Company", "company", true],
      ["entry_date", "Date", "date", true],
      ["voucher_no", "Voucher no.", "text"],
      ["vehicle_number", "Vehicle number", "text"],
      ["quantity", "Quantity (qtl)", "number"],
      ["rate", "Rate", "number"],
      ["gross_total", "Gross total (₹)", "number"],
      ["unload_date", "Unload date", "date"],
      ["unload_quantity", "Unload quantity (qtl)", "number"],
      ["payment_due_date", "Payment due date", "date"],
      ["purchase_reference", "Purchase reference", "text"],
      ["notes", "Notes", "text"],
    ],

    Payments: [
      ["company_id", "Company", "company", true],
      ["payment_date", "Payment date", "date", true],
      ["direction", "Direction", "select", true],
      ["amount", "Amount (₹)", "number", true],
      ["reference", "Reference", "text"],
      ["notes", "Notes", "text"],
    ],
  };

  // ===================================================
  // 14. TABLE COLUMNS
  // ===================================================

  const columns = {
    Companies: [
      "name",
      "company_type",
      "credit_days",
      "phone",
    ],

    Purchases: [
      "entry_date",
      "company_id",
      "voucher_no",
      "vehicle_number",
      "quantity",
      "purchase_total",
    ],

    Sales: [
      "entry_date",
      "company_id",
      "voucher_no",
      "vehicle_number",
      "quantity",
      "gross_total",
      "payment_due_date",
    ],

    Payments: [
      "payment_date",
      "company_id",
      "direction",
      "amount",
      "reference",
    ],
  };

  const titleMap = {
    quantity: "Quantity (qtl)",
    company_id: "Company",
    entry_date: "Date",
    payment_date: "Date",
    gross_total: "Sales total",
    purchase_total: "Purchase total",
    credit_days: "Credit days",
    vehicle_number: "Vehicle",
  };

  // ===================================================
  // 15. TABLE DISPLAY FORMAT
  // ===================================================

  function display(key, value) {
    if (key === "company_id") {
      return companyMap[value] || "—";
    }

    if (
      ["gross_total", "purchase_total", "amount"].includes(key)
    ) {
      return money(value);
    }

    if (key === "quantity" || key === "unload_quantity") {
      return value == null || value === "" ? "—" : `${qty(value)} qtl`;
    }

    return value ?? "—";
  }

  // ===================================================
  // 16. SAVE / UPDATE RECORD
  // ===================================================

  async function save(event) {
    event.preventDefault();

    setError("");
    setBusy(true);

    try {
      const formData = new FormData(event.currentTarget);

      const body = Object.fromEntries(formData.entries());

      const numericFields = [
        "quantity",
        "rate",
        "purchase_total",
        "gross_total",
        "unload_quantity",
        "amount",
        "credit_days",
      ];

      // NOT NULL numeric columns fall back to 0; optional text/date become null.
      const requiredNumeric = [
        "quantity",
        "rate",
        "purchase_total",
        "gross_total",
        "unload_quantity",
        "amount",
        "credit_days",
      ];

      numericFields.forEach((key) => {
        if (body[key] !== undefined) {
          body[key] =
            body[key] === ""
              ? requiredNumeric.includes(key) && key !== "amount"
                ? 0
                : null
              : Number(body[key]);
        }
      });

      Object.keys(body).forEach((key) => {
        if (body[key] === "" && !numericFields.includes(key)) {
          body[key] = null;
        }
      });

            await dispatch(
        saveRecord({ api, page: dataPage, id: editing?.id, body })
      ).unwrap();

      setModal(false);
      setEditing(null);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  // ===================================================
  // 17. DELETE RECORD
  // ===================================================

  async function remove(id) {
    if (!window.confirm("Are you sure you want to delete this record?")) {
      return;
    }

    setError("");
    setBusy(true);

    try {
            await dispatch(deleteRecord({ api, page, id })).unwrap();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  // ===================================================
  // 18. AUTHENTICATION LOADING SCREEN
  // ===================================================

  if (authLoading) {
    return (
      <main className="login-wrap">
        <div className="login-card">
          <div className="brand-mark">BC</div>
          <h2>Loading Business Portal...</h2>
          <p className="muted">Checking your login session.</p>
        </div>
      </main>
    );
  }

  // ===================================================
  // 19. LOGIN SCREEN
  // ===================================================

  if (!session) {
    return (
      <main className="login-wrap">
        <form className="login-card" onSubmit={login}>
          <div className="brand-mark">BC</div>

          <p className="eyebrow">BUSINESS CLOUD PORTAL</p>

          <h1>Welcome back</h1>

          <p className="muted">
            Sign in to manage your business records.
          </p>

          {error && <div className="error">{error}</div>}

          <label>
            Email

            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="username"
              required
            />
          </label>

          <label>
            Password

            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              required
            />
          </label>

          <button className="primary full" disabled={busy}>
            {busy ? "Signing in..." : "Sign in"}
          </button>

          <small className="muted">
            Create authorized accounts in your Supabase dashboard.
          </small>
        </form>
      </main>
    );
  }

  // ===================================================
  // 20. MAIN APPLICATION
  // ===================================================

  return (
    <div className="app-shell">

      {/* SIDEBAR */}

      <aside className={`sidebar ${mobile ? "open" : ""}`}>

        <div className="brand">
          <div className="brand-mark">BC</div>

          <div>
            <b>Business Portal</b>
            <small>MANAGEMENT SYSTEM</small>
          </div>
        </div>

        <div className="nav-label">WORKSPACE</div>

        {nav.map(([name, Icon]) => (
          <button
            key={name}
            className={`nav-item ${
              page === name ? "active" : ""
            }`}
            onClick={() => {
              setPage(name);
              setSearch("");
              dispatch(clearError());
              setMobile(false);
            }}
          >
            <Icon size={18} />
            {name}
          </button>
        ))}

        <div className="sidebar-bottom">

          <div className="user-chip">
            <div className="avatar">
              {session.user.email?.[0]?.toUpperCase()}
            </div>

            <div>
              <b>Account</b>
              <small>{session.user.email}</small>
            </div>
          </div>

          <button className="nav-item" onClick={logout}>
            <LogOut size={18} />
            Sign out
          </button>

        </div>
      </aside>

      {/* MAIN CONTENT */}

      <main className="main">

        {/* TOPBAR */}

        <header className="topbar">

          <button
            className="icon-btn mobile-menu"
            onClick={() => setMobile(!mobile)}
          >
            <Menu />
          </button>

          <div>
            <span className="muted">Workspace / </span>
            <b>{page}</b>
          </div>

          <div className="top-actions">

            {page !== "Dashboard" && page !== SUMMARY && (
              <button
                className="primary"
                onClick={() => {
                  setEditing(null);
                  setError("");
                  setModal(true);
                }}
              >
                <Plus size={16} />
                Add {dataPage.slice(0, -1)}
              </button>
            )}

            <span className="live-dot">● Connected</span>

            <button
              className="icon-btn"
              onClick={() => refresh(true)}
              title="Refresh"
              disabled={busy || Boolean(list?.loading) || summaryLoading}
            >
              <RefreshCw size={17} />
            </button>

          </div>
        </header>

        {/* PAGE CONTENT */}

        <section className="content">

          {/* ERROR MESSAGE */}

          {(error || storeError) && (
            <div className="error">
              {error || storeError}
            </div>
          )}

          {/* LOADING */}

          {busy && (
            <p className="muted">Processing request...</p>
          )}

          {/* DASHBOARD */}

          {page === "Dashboard" ? (

            <>
              <div className="stat-grid">

                {[
                  ["Total sales", stats?.sales, "blue"],
                  ["Total purchases", stats?.purchases, "violet"],
                  ["Payments received", stats?.collected, "green"],
                  ["Payments paid", stats?.disbursed, "amber"],
                  ["Receivable balance", stats?.receivable, "green"],
                  ["Payable balance", stats?.payable, "red"],
                ].map(([title, value, color]) => (

                  <div className="stat-card" key={title}>

                    <span>{title}</span>

                    <strong>{money(value)}</strong>

                    <small>All recorded transactions</small>

                    <div className={`stat-icon ${color}`}>
                      <Wallet size={18} />
                    </div>

                  </div>

                ))}

              </div>

              <div className="panel">

                <div className="panel-head">
                  <div>
                    <h3>Net cash position</h3>

                    <p className="muted">
                      Payments received minus payments paid
                    </p>
                  </div>
                </div>

                <div className="net-value">
                  {money(stats?.net)}
                </div>

              </div>
            </>

          ) : page === TRACK ? (

            /* VEHICLE TRACKING */

            <div className="panel">

              <div className="table-toolbar">

                <div>
                  <h3>Vehicle tracking</h3>

                  <p className="muted">
                    {trackFiltered
                      ? `${tracking.rows.length} records (filtered)`
                      : `${tracking.rows.length} records`}
                    {" · purchase company → sale company, matched by vehicle"}
                    {summaryLoading && !summaryFirstLoad && " · refreshing…"}
                  </p>
                </div>

                <div className="searchbox">
                  <Search size={16} />

                  <input
                    placeholder="Search vehicle / voucher..."
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                  />
                </div>

              </div>

              <div className="filter-bar">

                <label>
                  Purchase company
                  <select
                    value={tPCompany}
                    onChange={(e) => setTPCompany(e.target.value)}
                  >
                    <option value="">All companies</option>
                    {companies.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </label>

                <label>
                  Sale company
                  <select
                    value={tSCompany}
                    onChange={(e) => setTSCompany(e.target.value)}
                  >
                    <option value="">All companies</option>
                    {companies.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </label>

                <label>
                  From
                  <input
                    type="date"
                    value={tFrom}
                    max={tTo || undefined}
                    onChange={(e) => setTFrom(e.target.value)}
                  />
                </label>

                <label>
                  To
                  <input
                    type="date"
                    value={tTo}
                    min={tFrom || undefined}
                    onChange={(e) => setTTo(e.target.value)}
                  />
                </label>

                <label>
                  Status
                  <select
                    value={tStatus}
                    onChange={(e) => setTStatus(e.target.value)}
                  >
                    <option value="">All</option>
                    <option value="Sold">Sold</option>
                    <option value="Pending">Pending (not sold)</option>
                    <option value="No purchase">Sale without purchase</option>
                  </select>
                </label>

                {trackFiltered && (
                  <button
                    type="button"
                    className="secondary clear-filters"
                    onClick={() => {
                      setTPCompany("");
                      setTSCompany("");
                      setTFrom("");
                      setTTo("");
                      setTStatus("");
                      setSearch("");
                    }}
                  >
                    <X size={14} />
                    Clear filters
                  </button>
                )}

              </div>

              {summaryFirstLoad ? (

                <p className="muted pad">Loading records...</p>

              ) : (

                <div className="table-wrap">

                  <table className="summary-table">

                    <thead>
                      <tr>
                        <th>Vehicle</th>
                        <th>Purchase company</th>
                        <th>
                          <button
                            type="button"
                            className="sort-btn"
                            onClick={() => setTDesc(!tDesc)}
                            title={tDesc ? "Newest first — click for oldest first" : "Oldest first — click for newest first"}
                          >
                            Purchase date
                            {tDesc ? <ArrowDown size={13} /> : <ArrowUp size={13} />}
                          </button>
                        </th>
                        <th className="num">Qty (qtl)</th>
                        <th className="num">Purchase total</th>
                        <th>Sale company</th>
                        <th>Sale date</th>
                        <th className="num">Qty (qtl)</th>
                        <th className="num">Sale total</th>
                        <th className="num">Days</th>
                        <th className="num">Margin</th>
                        <th>Status</th>
                      </tr>
                    </thead>

                    <tbody>
                      {tracking.rows.map((r) => (
                        <tr key={r.key}>
                          <td><b>{r.p?.vehicle_number || r.s?.vehicle_number || "—"}</b></td>
                          <td>{r.p ? companyMap[r.p.company_id] || "—" : "—"}</td>
                          <td>{r.p ? dayOf(r.p.entry_date) : "—"}</td>
                          <td className="num">{r.p ? qty(r.p.quantity) : "—"}</td>
                          <td className="num">{r.p ? money(r.p.purchase_total) : "—"}</td>
                          <td>{r.s ? companyMap[r.s.company_id] || "—" : "—"}</td>
                          <td>{r.s ? dayOf(r.s.entry_date) : "—"}</td>
                          <td className="num">{r.s ? qty(r.s.quantity) : "—"}</td>
                          <td className="num">{r.s ? money(r.s.gross_total) : "—"}</td>
                          <td className="num">{r.days ?? "—"}</td>
                          <td className={`num ${r.margin > 0 ? "due-in" : r.margin < 0 ? "due-out" : ""}`}>
                            {r.margin === null ? "—" : money(r.margin)}
                          </td>
                          <td>
                            <span className={`status-pill ${r.status === "Sold" ? "sold" : r.status === "Pending" ? "pending" : "orphan"}`}>
                              {r.status === "No purchase" ? "No purchase found" : r.status}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>

                  </table>

                  {!tracking.rows.length && (
                    <p className="muted pad">No records found.</p>
                  )}

                </div>

              )}

              {!summaryFirstLoad && (
                <div className="totals-bar">

                  <div className="totals-label">
                    {trackFiltered ? "Filtered totals" : "Totals"}
                    <small>{tracking.rows.length} records · {tracking.totals.pending} pending</small>
                  </div>

                  <div className="totals-items">
                    <div>
                      <span>Purchase qty (qtl)</span>
                      <b>{qty(tracking.totals.pQty)}</b>
                    </div>
                    <div>
                      <span>Purchase total</span>
                      <b>{money(tracking.totals.pTotal)}</b>
                    </div>
                    <div>
                      <span>Sale qty (qtl)</span>
                      <b>{qty(tracking.totals.sQty)}</b>
                    </div>
                    <div>
                      <span>Sale total</span>
                      <b>{money(tracking.totals.sTotal)}</b>
                    </div>
                    <div>
                      <span>Margin (sold)</span>
                      <b>{money(tracking.totals.margin)}</b>
                    </div>
                  </div>

                </div>
              )}

            </div>

          ) : page === SUMMARY ? (

            /* COMPANY SUMMARY */

            <div className="panel">

              <div className="table-toolbar">

                <div>
                  <h3>Company summary</h3>

                  <p className="muted">
                    {summary.rows.length} companies · purchases, sales, payments and dues
                    {summaryLoading && !summaryFirstLoad && " · refreshing…"}
                  </p>
                </div>

                <div className="searchbox">
                  <Search size={16} />

                  <input
                    placeholder="Search company..."
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                  />
                </div>

              </div>

              <div className="filter-bar">

                <label>
                  Company
                  <select
                    value={sCompany}
                    onChange={(e) => setSCompany(e.target.value)}
                  >
                    <option value="">All companies</option>
                    {companies.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </label>

                <label>
                  From
                  <input
                    type="date"
                    value={sFrom}
                    max={sTo || undefined}
                    onChange={(e) => setSFrom(e.target.value)}
                  />
                </label>

                <label>
                  To
                  <input
                    type="date"
                    value={sTo}
                    min={sFrom || undefined}
                    onChange={(e) => setSTo(e.target.value)}
                  />
                </label>

                {(sCompany || sFrom || sTo) && (
                  <button
                    type="button"
                    className="secondary clear-filters"
                    onClick={() => {
                      setSCompany("");
                      setSFrom("");
                      setSTo("");
                    }}
                  >
                    <X size={14} />
                    Clear filters
                  </button>
                )}

              </div>

              {summaryFirstLoad ? (

                <p className="muted pad">Loading records...</p>

              ) : (

                <div className="table-wrap">

                  <table className="summary-table">

                    <thead>
                      <tr>
                        <th>Company</th>
                        <th className="num">Purchase qty (qtl)</th>
                        <th className="num">Purchase total</th>
                        <th className="num">Paid</th>
                        <th className="num">Payable due</th>
                        <th className="num">Sales qty (qtl)</th>
                        <th className="num">Sales total</th>
                        <th className="num">Received</th>
                        <th className="num">Receivable due</th>
                        <th className="num">Net balance</th>
                      </tr>
                    </thead>

                    <tbody>
                      {summary.rows.map((c) => (
                        <tr key={c.id}>
                          <td><b>{c.name}</b></td>
                          <td className="num">{qty(c.pQty)}</td>
                          <td className="num">{money(c.pTotal)}</td>
                          <td className="num">{money(c.paid)}</td>
                          <td className={`num ${c.payable > 0 ? "due-out" : ""}`}>{money(c.payable)}</td>
                          <td className="num">{qty(c.sQty)}</td>
                          <td className="num">{money(c.sTotal)}</td>
                          <td className="num">{money(c.received)}</td>
                          <td className={`num ${c.receivable > 0 ? "due-in" : ""}`}>{money(c.receivable)}</td>
                          <td className={`num ${c.net > 0 ? "due-in" : c.net < 0 ? "due-out" : ""}`}>{money(c.net)}</td>
                        </tr>
                      ))}
                    </tbody>

                    {summary.rows.length > 0 && (
                      <tfoot>
                        <tr>
                          <td>Total</td>
                          <td className="num">{qty(summary.totals.pQty)}</td>
                          <td className="num">{money(summary.totals.pTotal)}</td>
                          <td className="num">{money(summary.totals.paid)}</td>
                          <td className="num">{money(summary.totals.payable)}</td>
                          <td className="num">{qty(summary.totals.sQty)}</td>
                          <td className="num">{money(summary.totals.sTotal)}</td>
                          <td className="num">{money(summary.totals.received)}</td>
                          <td className="num">{money(summary.totals.receivable)}</td>
                          <td className="num">{money(summary.totals.net)}</td>
                        </tr>
                      </tfoot>
                    )}

                  </table>

                  {!summary.rows.length && (
                    <p className="muted pad">No records found.</p>
                  )}

                </div>

              )}

              {!summaryFirstLoad && (
                <div className="totals-bar">

                  <div className="totals-label">
                    {sCompany || sFrom || sTo || search ? "Filtered totals" : "Totals"}
                    <small>{summary.rows.length} companies</small>
                  </div>

                  <div className="totals-items">
                    <div>
                      <span>Purchase qty (qtl)</span>
                      <b>{qty(summary.totals.pQty)}</b>
                    </div>
                    <div>
                      <span>Sales qty (qtl)</span>
                      <b>{qty(summary.totals.sQty)}</b>
                    </div>
                    <div>
                      <span>Payable due</span>
                      <b>{money(summary.totals.payable)}</b>
                    </div>
                    <div>
                      <span>Receivable due</span>
                      <b>{money(summary.totals.receivable)}</b>
                    </div>
                    <div>
                      <span>Net (receivable − payable)</span>
                      <b>{money(summary.totals.net)}</b>
                    </div>
                  </div>

                </div>
              )}

            </div>

          ) : ( /* DATA TABLE */

            <div className="panel">

              <div className="table-toolbar">

                <div>
                  <h3>{page} register</h3>

                  <p className="muted">
                    {filtered.length} of {rows.length} records
                    {hasFilters && sortDir === "desc"
                      ? " · newest first"
                      : hasFilters
                      ? " · oldest first"
                      : ""}
                    
                    {refreshing && " · refreshing…"}
                  </p>
                </div>

                <div className="searchbox">
                  <Search size={16} />

                  <input
                    placeholder="Search records..."
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                  />
                </div>

              </div>

              {hasFilters && (
                <div className="filter-bar">

                  <label>
                    Company
                    <select
                      value={filters.company}
                      onChange={(e) =>
                        dispatch(setFilter({ page, key: "company", value: e.target.value }))
                      }
                    >
                      <option value="">All companies</option>
                      {companies.map((c) => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                  </label>

                  <label>
                    From
                    <input
                      type="date"
                      value={filters.from}
                      max={filters.to || undefined}
                      onChange={(e) =>
                        dispatch(setFilter({ page, key: "from", value: e.target.value }))
                      }
                    />
                  </label>

                  <label>
                    To
                    <input
                      type="date"
                      value={filters.to}
                      min={filters.from || undefined}
                      onChange={(e) =>
                        dispatch(setFilter({ page, key: "to", value: e.target.value }))
                      }
                    />
                  </label>

                  {page === "Payments" && (
                    <label>
                      Direction
                      <select
                        value={filters.direction}
                        onChange={(e) =>
                          dispatch(setFilter({ page, key: "direction", value: e.target.value }))
                        }
                      >
                        <option value="">All</option>
                        <option value="received">Received</option>
                        <option value="paid">Paid</option>
                      </select>
                    </label>
                  )}

                  {activeFilterCount > 0 && (
                    <button
                      type="button"
                      className="secondary clear-filters"
                      onClick={() => dispatch(clearFilters(page))}
                    >
                      <X size={14} />
                      Clear filters ({activeFilterCount})
                    </button>
                  )}

                </div>
              )}

              {firstLoad ? (

                <p className="muted pad">
                  Loading records...
                </p>

              ) : (

                <div className="table-wrap">

                  <table>

                    <thead>
                      <tr>

                        {columns[page].map((key) => (
                          <th key={key}>
                            {key === dateKey ? (
                              <button
                                type="button"
                                className="sort-btn"
                                onClick={() => dispatch(toggleSort(page))}
                                title={sortDir === "desc" ? "Newest first — click for oldest first" : "Oldest first — click for newest first"}
                              >
                                {titleMap[key] || key}
                                {sortDir === "desc" ? <ArrowDown size={13} /> : <ArrowUp size={13} />}
                              </button>
                            ) : (
                              titleMap[key] || key.replaceAll("_", " ")
                            )}
                          </th>
                        ))}

                        <th>Actions</th>

                      </tr>
                    </thead>

                    <tbody>

                      {filtered.map((record) => (

                        <tr key={record.id}>

                          {columns[page].map((key) => (
                            <td key={key}>
                              {display(key, record[key])}
                            </td>
                          ))}

                          <td>

                            <div className="row-actions">

                              <button
                                onClick={() => {
                                  setEditing(record);
                                  setError("");
                                  setModal(true);
                                }}
                                title="Edit"
                              >
                                <Edit3 size={16} />
                              </button>

                              <button
                                onClick={() => remove(record.id)}
                                title="Delete"
                              >
                                <Trash2 size={16} />
                              </button>

                            </div>

                          </td>

                        </tr>

                      ))}

                    </tbody>

                  </table>

                  {!filtered.length && (
                    <p className="muted pad">
                      {rows.length && activeFilterCount ? "No records match these filters." : "No records found."}
                    </p>
                  )}

                </div>

              )}

              {hasFilters && !firstLoad && (
                <div className="totals-bar">

                  <div className="totals-label">
                    {activeFilterCount > 0 || search ? "Filtered totals" : "Totals"}
                    <small>{filtered.length} records</small>
                  </div>

                  <div className="totals-items">

                    {page === "Payments" ? (
                      <>
                        <div>
                          <span>Received</span>
                          <b>{money(totals.received)}</b>
                        </div>
                        <div>
                          <span>Paid</span>
                          <b>{money(totals.paid)}</b>
                        </div>
                        <div>
                          <span>Net</span>
                          <b>{money(totals.received - totals.paid)}</b>
                        </div>
                      </>
                    ) : (
                      <>
                        <div>
                          <span>Total quantity (qtl)</span>
                          <b>{qty(totals.quantity)} qtl</b>
                        </div>
                        <div>
                          <span>{page === "Sales" ? "Total sales" : "Total purchases"}</span>
                          <b>{money(totals.amount)}</b>
                        </div>
                      </>
                    )}

                  </div>

                </div>
              )}

            </div>

          )}

        </section>

      </main>

      {/* ADD / EDIT MODAL */}

      {modal && (

        <div
          className="modal-backdrop"
          onClick={() => setModal(false)}
        >

          <form
            className="modal"
            onSubmit={save}
            onClick={(event) => event.stopPropagation()}
          >

            <div className="modal-head">

              <div>
                <p className="eyebrow">RECORD MANAGEMENT</p>

                <h2>
                  {editing ? "Edit" : "Add"} {dataPage.slice(0, -1)}
                </h2>
              </div>

              <button
                type="button"
                className="icon-btn"
                onClick={() => setModal(false)}
              >
                ✕
              </button>

            </div>

            <div className="form-grid">

              {fields[dataPage].map(
                ([key, label, type, required]) => (

                  <label
                    key={key}
                    className={
                      type === "text" && key === "notes"
                        ? "wide"
                        : ""
                    }
                  >

                    {label}

                    {type === "company" ? (

                      <select
                        name={key}
                        defaultValue={editing?.[key] || ""}
                        required={required}
                      >

                        <option value="">
                          Select company
                        </option>

                        {companies.map((company) => (
                          <option
                            value={company.id}
                            key={company.id}
                          >
                            {company.name}
                          </option>
                        ))}

                      </select>

                    ) : type === "select" ? (

                      <select
                        name={key}
                        defaultValue={
                          editing?.[key] ||
                          (key === "company_type"
                            ? "Both"
                            : "received")
                        }
                        required={required}
                      >

                        {(key === "company_type"
                          ? ["Customer", "Supplier", "Both"]
                          : ["received", "paid"]
                        ).map((value) => (

                          <option key={value} value={value}>
                            {value}
                          </option>

                        ))}

                      </select>

                    ) : (

                      <input
                        name={key}
                        type={type}
                        step={type === "number" ? "any" : undefined}
                        defaultValue={
                          editing?.[key] ??
                          (type === "date" ? today() : "")
                        }
                        required={required}
                      />

                    )}

                  </label>

                )
              )}

            </div>

            <div className="modal-actions">

              <button
                type="button"
                className="secondary"
                onClick={() => {
                  setModal(false);
                  setEditing(null);
                }}
              >
                Cancel
              </button>

              <button
                className="primary"
                disabled={busy}
              >
                {busy ? "Saving..." : "Save record"}
              </button>

            </div>

          </form>

        </div>

      )}

    </div>
  );
}