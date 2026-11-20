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
  clearError,
  clearData,
  setBusiness,
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
  ArrowUpDown,
  Scale,
  Truck,
  Banknote,
  ClipboardList,
  ListChecks,
  BookOpen,
  Folder,
  FolderOpen,
  ChevronDown,
  ArrowDown,
  X,
  FileSpreadsheet,
  FileText,
} from "lucide-react";

import { exportExcel, exportPdf } from "./exportUtils";
import Dashboard from "./Dashboard";

// =====================================================
// 1. ENVIRONMENT CONFIGURATION
// =====================================================

// API BASE URL
const API = (import.meta.env.VITE_API_URL || "").trim().replace(/\/+$/, "");

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!API) {
  console.error("VITE_API_URL is missing.");
}

if (!SUPABASE_URL || !SUPABASE_KEY) {
  throw new Error(
    "Missing Supabase configuration. Check your frontend environment variables.",
  );
}

// =====================================================
// 2. SUPABASE CLIENT
// =====================================================

const auth = createClient(SUPABASE_URL, SUPABASE_KEY);

// =====================================================
// 3. NAVIGATION
// =====================================================

// Names shown on screen when they differ from the page id
const PAGE_LABEL = {
  Orders: "Purchase Orders",
  Dues: "Payment Dues",
  Unloads: "Unload Status",
};

// Pages shown directly in the sidebar
const nav = [
  ["Dashboard", LayoutDashboard],
  ["Companies", Building2],
];

// Dropdown folders in the sidebar. Add page names to `items` to move them in.
const folders = [
  {
    name: "DDGS",
    items: [
      ["Purchases", ShoppingCart],
      ["Sales", Receipt],
      ["Payments", Wallet],
      ["Vehicle Rent", Banknote],
      ["Orders", ClipboardList],
    ],
  },
  {
    name: "Maize and Turmeric",
    items: [
      ["Purchases", ShoppingCart],
      ["Sales", Receipt],
      ["Payments", Wallet],
      ["Vehicle Rent", Banknote],
      ["Orders", ClipboardList],
    ],
  },
];

// The role comes from the login token itself (the same token Supabase uses to
// decide what this user may read), so the screen always matches the database.
function getRole(session) {
  try {
    const payload = session.access_token.split(".")[1];
    const json = JSON.parse(
      decodeURIComponent(
        atob(payload.replace(/-/g, "+").replace(/_/g, "/"))
          .split("")
          .map((c) => "%" + c.charCodeAt(0).toString(16).padStart(2, "0"))
          .join(""),
      ),
    );
    return json?.app_metadata?.role || session.user?.app_metadata?.role || "";
  } catch {
    return session?.user?.app_metadata?.role || "";
  }
}

// Pages only the owner can open (also enforced by the API and Supabase RLS)
const OWNER_ONLY_PAGES = ["Payments", "Vehicle Rent"];

// Pages a view-only account does not get in its sidebar
const VIEWER_HIDDEN_PAGES = ["Companies"];

// Sidebar is always listed A to Z (pages inside each folder too)
const byName = (a, b) => a.localeCompare(b, undefined, { sensitivity: "base" });
// ---- remember the open page, so a browser refresh does not jump to Dashboard
const VIEW_KEY = "ms-view";

function readView() {
  try {
    const v = JSON.parse(localStorage.getItem(VIEW_KEY) || "{}");
    if (!v.biz && nav.some(([n]) => n === v.page))
      return { page: v.page, biz: "" };

    const folder = folders.find((f) => f.name === v.biz);
    const tabPages = ["Ledger", "Dues", "Unloads", "Vehicle Tracking"]; // opened from the tab strip
    if (
      folder &&
      (folder.items.some(([n]) => n === v.page) || tabPages.includes(v.page))
    ) {
      return { page: v.page, biz: v.biz };
    }
  } catch {
    /* storage unavailable: start on the dashboard */
  }
  return { page: "Dashboard", biz: "" };
}

const labelOf = (id) => PAGE_LABEL[id] || id;
nav.sort(([a], [b]) => byName(labelOf(a), labelOf(b)));
folders.sort((a, b) => byName(a.name, b.name));
folders.forEach((f) =>
  f.items.sort(([a], [b]) => byName(labelOf(a), labelOf(b))),
);

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
    Number(value || 0),
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
  Orders: "order_date",
};

const TOTAL_KEY = {
  Purchases: "purchase_total",
  Sales: "gross_total",
  Orders: "order_total",
};

const SUMMARY = "Company Summary";
const LEDGER = "Ledger";
const TRACK = "Vehicle Tracking";
const RENT = "Vehicle Rent";
const DUES = "Dues";
const UNLOAD = "Unloads";

// singular names used on the "Add ..." button and the modal title
const RECORD_LABEL = {
  Companies: "Company",
  Purchases: "Purchase",
  Sales: "Sale",
  Payments: "Payment",
  Rents: "Vehicle rent",
  Orders: "Purchase order",
};

// table names shown in the "saved" popup
const TABLE_NAME = {
  Companies: "Companies",
  Purchases: "Purchases",
  Sales: "Sales",
  Payments: "Payments",
  Rents: "Vehicle Rent",
  Orders: "Purchase Orders",
};

const savedLine = (r, page) =>
  `${RECORD_LABEL[page]} ${r.created ? "added to" : "updated in"} the ${TABLE_NAME[page]} table - ${
    r.verified
      ? "server confirmed ✓"
      : "saved, but the server list could not confirm it yet (press refresh)"
  }`;

// vehicle numbers compared without spaces / dashes / case
const normVehicle = (v) =>
  String(v || "")
    .replace(/[\s-]/g, "")
    .toUpperCase();

const daysBetween = (from, to) =>
  Math.round((Date.parse(dayOf(to)) - Date.parse(dayOf(from))) / 86400000);

const EMPTY_ROWS = [];
const EMPTY_FILTERS = { company: "", from: "", to: "", direction: "" };

const dayOf = (value) => String(value || "").slice(0, 10);

// A rent row is linked to the purchase of the same vehicle whose date is
// closest (within this many days). Same company wins ties.
// A rent counts as paid when it has a paid date, or when it was paid to the
// account "Loading" (loading charges are settled on the spot)
const isRentPaid = (r) =>
  Boolean(r.paid_date) ||
  String(r.account_name || "")
    .trim()
    .toLowerCase() === "loading";

const RENT_MATCH_DAYS = 15;

// Payments are not linked to single bills, so they are applied oldest-first:
// the oldest payments of a company settle that company's oldest bills.
// Returns, per bill id, the date it became fully paid ("" = still open) and
// the amount still open.
function allocatePayments(bills, payments) {
  const TOL = 1; // rupee rounding

  const pools = {};
  payments.forEach((p) => {
    (pools[p.company_id] = pools[p.company_id] || []).push({
      date: dayOf(p.payment_date),
      left: Number(p.amount || 0),
      created: String(p.created_at || ""),
    });
  });
  Object.values(pools).forEach((list) =>
    list.sort(
      (a, b) =>
        a.date.localeCompare(b.date) || a.created.localeCompare(b.created),
    ),
  );

  const out = {};
  [...bills]
    .sort(
      (a, b) =>
        dayOf(a.date).localeCompare(dayOf(b.date)) ||
        String(a.created_at || "").localeCompare(String(b.created_at || "")),
    )
    .forEach((bill) => {
      let need = bill.total;
      let last = "";

      for (const p of pools[bill.company_id] || []) {
        if (need <= TOL) break;
        if (p.left <= 0) continue;
        const use = Math.min(need, p.left);
        p.left -= use;
        need -= use;
        last = p.date;
      }

      out[bill.id] = {
        received: bill.total > 0 && need <= TOL ? last : "",
        balance: Math.max(need, 0),
      };
    });

  return out;
}

function matchRents(rents, purchases) {
  const byVehicle = {};

  purchases.forEach((p) => {
    const k = normVehicle(p.vehicle_number);
    if (k) (byVehicle[k] = byVehicle[k] || []).push(p);
  });

  const claimed = new Set();
  const rentByPurchase = {}; // purchase id -> total rent
  const linked = {}; // rent id -> purchase

  [...rents]
    .sort((a, b) => dayOf(a.entry_date).localeCompare(dayOf(b.entry_date)))
    .forEach((r) => {
      const best = (byVehicle[normVehicle(r.vehicle_number)] || [])
        .map((p) => ({
          p,
          gap: Math.abs(daysBetween(r.entry_date, p.entry_date)),
          sameCo: p.company_id === r.company_id,
          free: !claimed.has(p.id),
        }))
        .filter((x) => x.gap <= RENT_MATCH_DAYS)
        .sort(
          (a, b) =>
            Number(b.sameCo) - Number(a.sameCo) ||
            a.gap - b.gap ||
            Number(b.free) - Number(a.free),
        )[0];

      if (!best) return;

      claimed.add(best.p.id);
      linked[r.id] = best.p;
      rentByPurchase[best.p.id] =
        (rentByPurchase[best.p.id] || 0) + Number(r.amount || 0);
    });

  return { rentByPurchase, linked };
}

// ---------- column sorting (used by every table) ----------

const NUMERIC_KEYS = [
  "quantity",
  "rate",
  "purchase_total",
  "gross_total",
  "amount",
  "credit_days",
  "unload_quantity",
  "pay_days",
  "order_total",
];
const DATE_KEYS = [
  "entry_date",
  "payment_date",
  "payment_due_date",
  "unload_date",
  "paid_date",
  "pay_received",
  "paid_on",
  "order_date",
  "delivery_date",
];

const DEFAULT_SORT = {
  Purchases: { key: "entry_date", dir: "asc" },
  Sales: { key: "entry_date", dir: "asc" },
  Payments: { key: "payment_date", dir: "asc" },
};
const NO_SORT = { key: "", dir: "asc" };

const isEmptyValue = (v) =>
  v === null ||
  v === undefined ||
  v === "" ||
  (typeof v === "number" && Number.isNaN(v));

// numbers compare as numbers, text compares naturally ("9" before "10"),
// empty cells always go last
function sortRows(rows, getter, sort, tie) {
  if (!getter || !sort?.key) return rows;
  const dir = sort.dir === "asc" ? 1 : -1;

  return [...rows].sort((a, b) => {
    const x = getter(a);
    const y = getter(b);
    const xe = isEmptyValue(x);
    const ye = isEmptyValue(y);

    if (xe || ye) return xe === ye ? 0 : xe ? 1 : -1;

    const c =
      typeof x === "number" && typeof y === "number"
        ? x - y
        : String(x).localeCompare(String(y), undefined, {
            numeric: true,
            sensitivity: "base",
          });

    if (c) return c * dir;
    return tie ? tie(a, b) * dir : 0;
  });
}

const byCreated = (a, b) =>
  String(a.created_at || a.id).localeCompare(String(b.created_at || b.id));

// first click: text A→Z, numbers and dates biggest / newest first
const nextSort = (cur, key, firstDir) =>
  cur.key === key
    ? { key, dir: cur.dir === "asc" ? "desc" : "asc" }
    : { key, dir: firstDir };

function SortTh({
  label,
  k,
  sort,
  onSort,
  kind = "text",
  right = false,
  title,
}) {
  const active = sort.key === k;
  const Icon = !active ? ArrowUpDown : sort.dir === "asc" ? ArrowUp : ArrowDown;

  return (
    <th
      className={right ? "num" : undefined}
      aria-sort={
        active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"
      }
    >
      <button
        type="button"
        className={`sort-btn ${active ? "active" : ""}`}
        onClick={() => onSort(k, kind === "text" ? "asc" : "desc")}
        title={title || `Sort by ${label}`}
      >
        {label}
        <Icon size={13} className={active ? "" : "sort-idle"} />
      </button>
    </th>
  );
}

const getErrorMessage = (error) =>
  error?.message || "Something went wrong. Please try again.";

// =====================================================
// 5. MAIN APP
// =====================================================

export default function App() {
  const [session, setSession] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);

  const [page, setPage] = useState(() => readView().page);

  // the Vehicle Tracking page adds Purchase records
  const dataPage =
    page === TRACK
      ? "Purchases"
      : page === RENT
        ? "Rents"
        : page === UNLOAD
          ? "Sales"
          : page;

  // ---- Redux (cached data, filters, sort)
  const dispatch = useDispatch();
  const stats = useSelector((s) => s.data.stats);
  const storeError = useSelector((s) => s.data.error);
  const companies = useSelector((s) => s.data.lists.Companies.items);
  const list = useSelector((s) => s.data.lists[page]);
  const filters = useSelector((s) => s.data.filters[page]) || EMPTY_FILTERS;

  const purchasesList = useSelector((s) => s.data.lists.Purchases);
  const salesList = useSelector((s) => s.data.lists.Sales);
  const paymentsList = useSelector((s) => s.data.lists.Payments);
  const rentsList = useSelector((s) => s.data.lists.Rents);

  // Payment received (sales) / paid (purchases) dates and the day count
  const alloc = useMemo(() => {
    const received = paymentsList.items.filter(
      (p) => p.direction === "received",
    );
    const paid = paymentsList.items.filter((p) => p.direction === "paid");

    const salesAlloc = allocatePayments(
      salesList.items.map((x) => ({
        id: x.id,
        company_id: x.company_id,
        date: x.entry_date,
        total: Number(x.gross_total || 0),
        created_at: x.created_at,
      })),
      received,
    );

    const purchasesAlloc = allocatePayments(
      purchasesList.items.map((x) => ({
        id: x.id,
        company_id: x.company_id,
        date: x.entry_date,
        total: Number(x.purchase_total || 0),
        created_at: x.created_at,
      })),
      paid,
    );

    const now = today();
    const sales = {};

    salesList.items.forEach((x) => {
      const a = salesAlloc[x.id] || { received: "", balance: 0 };

      // days only count once the vehicle is unloaded (unload quantity > 0)
      const unloaded = Number(x.unload_quantity || 0) > 0;
      const start = unloaded ? dayOf(x.unload_date) || dayOf(x.entry_date) : "";

      sales[x.id] = {
        received: a.received,
        balance: a.balance,
        pending: !a.received,
        days: start ? Math.max(0, daysBetween(start, a.received || now)) : null,
      };
    });

    const purchases = {};
    purchasesList.items.forEach((x) => {
      purchases[x.id] = purchasesAlloc[x.id] || { received: "", balance: 0 };
    });

    return { sales, purchases };
  }, [salesList, purchasesList, paymentsList]);

  const baseRows = list?.items || EMPTY_ROWS;
  const rows = useMemo(() => {
    if (page === "Sales") {
      return baseRows.map((r) => {
        const a = alloc.sales[r.id];
        return {
          ...r,
          pay_received: a?.received || "",
          pay_days: a ? a.days : null,
          pay_pending: Boolean(a?.pending),
        };
      });
    }

    if (page === "Purchases") {
      return baseRows.map((r) => ({
        ...r,
        paid_on: alloc.purchases[r.id]?.received || "",
      }));
    }

    return baseRows;
  }, [baseRows, page, alloc]);
  const firstLoad = Boolean(list?.loading && !list?.loaded);
  const refreshing = Boolean(list?.loading && list?.loaded);

  const summaryParts = [purchasesList, salesList, paymentsList, rentsList];
  const summaryLoading = summaryParts.some((l) => l.loading);
  const summaryFirstLoad = summaryParts.some((l) => l.loading && !l.loaded);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // popup shown after a record is added / updated / deleted
  const [notice, setNotice] = useState(null);
  useEffect(() => {
    if (!notice) return undefined;
    const timer = setTimeout(
      () => setNotice(null),
      notice.tone === "error" ? 9000 : 6000,
    );
    return () => clearTimeout(timer);
  }, [notice]);
  const [search, setSearch] = useState("");

  const [modal, setModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [mobile, setMobile] = useState(false);

  // desktop: the sidebar is a slim icon rail; the Menu button widens it
  const [wide, setWide] = useState(() => {
    try {
      return localStorage.getItem("ms-sidebar-wide") === "yes";
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem("ms-sidebar-wide", wide ? "yes" : "no");
    } catch {
      /* ignore */
    }
  }, [wide]);

  // sidebar folders: open/closed
  const [openFolders, setOpenFolders] = useState({});
  const [flyTop, setFlyTop] = useState(80); // where the folder pop-out opens

  // rail mode: a pop-out folder closes when you click anywhere else
  useEffect(() => {
    if (wide) return undefined;
    const close = (e) => {
      if (!e.target.closest?.(".sidebar")) setOpenFolders({});
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [wide]);

  // which business the current page belongs to ("" = Dashboard / Companies)
  const [biz, setBiz] = useState(() => readView().biz);

  // the data store must start on the same business as the restored page
  useEffect(() => {
    dispatch(setBusiness(biz));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(VIEW_KEY, JSON.stringify({ page, biz }));
    } catch {
      /* ignore */
    }
  }, [page, biz]);

  // Company Summary filters
  const [sCompany, setSCompany] = useState("");
  const [sFrom, setSFrom] = useState("");
  const [sTo, setSTo] = useState("");

  // Vehicle Tracking filters
  const [exporting, setExporting] = useState(false);
  const [dueExport, setDueExport] = useState(null); // "excel" | "pdf" while choosing a list
  const [tPCompany, setTPCompany] = useState("");
  const [tSCompany, setTSCompany] = useState("");
  const [tFrom, setTFrom] = useState("");
  const [tTo, setTTo] = useState("");
  const [tStatus, setTStatus] = useState("");
  const [tSort, setTSort] = useState({ key: "pdate", dir: "asc" });

  // Vehicle Rent filters
  const [rCompany, setRCompany] = useState("");
  const [rAccount, setRAccount] = useState("");
  const [rFrom, setRFrom] = useState("");
  const [rTo, setRTo] = useState("");
  const [rStatus, setRStatus] = useState("");
  const [rSort, setRSort] = useState({ key: "entry_date", dir: "asc" });

  // Company Summary + generic table sorting
  const [sSort, setSSort] = useState({ key: "name", dir: "asc" });

  // Ledger filters + sort
  const [lCompany, setLCompany] = useState("");
  const [lType, setLType] = useState("");
  const [lFrom, setLFrom] = useState("");
  const [lTo, setLTo] = useState("");
  const [lSort, setLSort] = useState({ key: "date", dir: "asc" });
  const sortL = (k, d) => setLSort((c) => nextSort(c, k, d));

  // Payment Dues page: two simple lists
  const [dueSort, setDueSort] = useState({ key: "amount", dir: "desc" });
  const [paySort, setPaySort] = useState({ key: "amount", dir: "desc" });
  const sortDue = (k, d) => setDueSort((c) => nextSort(c, k, d));
  const sortPay = (k, d) => setPaySort((c) => nextSort(c, k, d));

  // Unload Status page
  const [uCompany, setUCompany] = useState("");
  const [uStatus, setUStatus] = useState("");
  const [uFrom, setUFrom] = useState("");
  const [uTo, setUTo] = useState("");
  const [uSort, setUSort] = useState({ key: "entry_date", dir: "desc" });
  const sortU = (k, d) => setUSort((c) => nextSort(c, k, d));
  const [unloadEdit, setUnloadEdit] = useState(null);
  const [dataSorts, setDataSorts] = useState({});
  const dataSort = dataSorts[page] || DEFAULT_SORT[page] || NO_SORT;

  const sortT = (k, d) => setTSort((c) => nextSort(c, k, d));
  const sortR = (k, d) => setRSort((c) => nextSort(c, k, d));
  const sortS = (k, d) => setSSort((c) => nextSort(c, k, d));
  const sortData = (k, d) =>
    setDataSorts((all) => ({
      ...all,
      [page]: nextSort(all[page] || DEFAULT_SORT[page] || NO_SORT, k, d),
    }));

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
          "VITE_API_URL is missing. Check GitHub Actions variables.",
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
          "Cannot connect to Render backend. Check API URL and CORS.",
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
            `Invalid JSON response. HTTP ${response.status}. URL: ${url}`,
          );
        }
      }

      if (!response.ok) {
        if (response.status === 401) {
          throw new Error("Authentication failed. Please sign in again.");
        }

        throw new Error(
          data?.error || `API request failed (${response.status})`,
        );
      }

      return data;
    },
    [headers],
  );

  // ===================================================
  // 9. LOAD DATA (cached in Redux, refreshed in background)
  // ===================================================

  const userId = session?.user?.id || null;
  // set in Supabase: app_metadata -> { "role": "owner" } (see owner_permissions.sql)
  const role = session ? getRole(session) : "";
  const isOwner = role === "owner";
  // viewers can look at records but cannot add, edit or delete
  const isViewer = role === "viewer";
  // owner and viewer can read payments (Ledger, Company Summary, Dashboard);
  // vehicle rent data is owner only
  const canSeeFinance = isOwner || isViewer;
  const allowedLists = (lists) =>
    lists.filter((p) =>
      p === "Rents" ? isOwner : p === "Payments" ? canSeeFinance : true,
    );

  const refresh = useCallback(
    (force = false) => {
      if (!session) return;

      dispatch(fetchStats({ api, force, business: biz }));
      dispatch(fetchList({ api, page: "Companies", force }));

      if (page === TRACK) {
        // rent is needed here to deduct it from the margin
        allowedLists(["Purchases", "Sales", "Payments", "Rents"]).forEach((p) =>
          dispatch(fetchList({ api, page: p, force, business: biz })),
        );
      } else if (page === RENT) {
        allowedLists(["Rents", "Purchases"]).forEach((p) =>
          dispatch(fetchList({ api, page: p, force, business: biz })),
        );
      } else if (
        page === SUMMARY ||
        page === LEDGER ||
        page === DUES ||
        page === UNLOAD
      ) {
        allowedLists(["Purchases", "Sales", "Payments"]).forEach((p) =>
          dispatch(fetchList({ api, page: p, force, business: biz })),
        );
      } else if (
        page !== "Dashboard" &&
        page !== "Companies" &&
        allowedLists([page]).length
      ) {
        dispatch(fetchList({ api, page, force, business: biz }));
        // Sales / Purchases show when each bill was paid
        if (page === "Sales" || page === "Purchases") {
          allowedLists(["Payments"]).forEach((p) =>
            dispatch(fetchList({ api, page: p, force, business: biz })),
          );
        }
      }
    },
    [session, page, biz, api, dispatch, isOwner, isViewer],
  );

  // ---- first load after sign-in: fetch everything before showing the app
  const [bootedFor, setBootedFor] = useState(null);
  const [bootProgress, setBootProgress] = useState({ done: 0, total: 1 });
  const [bootSlow, setBootSlow] = useState(false);
  const booting = Boolean(userId) && bootedFor !== userId;

  useEffect(() => {
    if (!userId) {
      setBootedFor(null);
      return undefined;
    }

    let active = true;

    const jobs = [
      fetchStats({ api, force: true, business: "" }), // dashboard (all)
      fetchList({ api, page: "Companies", force: true }),
    ];

    folders.forEach((f) =>
      allowedLists([
        "Purchases",
        "Sales",
        "Payments",
        "Rents",
        "Orders",
      ]).forEach((p) =>
        jobs.push(fetchList({ api, page: p, force: true, business: f.name })),
      ),
    );

    setBootProgress({ done: 0, total: jobs.length });
    setBootSlow(false);
    const slowTimer = setTimeout(() => active && setBootSlow(true), 8000);

    Promise.all(
      jobs.map((job) =>
        dispatch(job).then(() => {
          if (active) setBootProgress((p) => ({ ...p, done: p.done + 1 }));
        }),
      ),
    ).then(() => {
      if (active) setBootedFor(userId);
    });

    return () => {
      active = false;
      clearTimeout(slowTimer);
    };
    // runs once per signed-in user (not on token refresh)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  useEffect(() => {
    if (
      session &&
      ((!isOwner && OWNER_ONLY_PAGES.includes(page)) ||
        (isViewer && VIEWER_HIDDEN_PAGES.includes(page)))
    ) {
      dispatch(setBusiness(""));
      setBiz("");
      setPage("Dashboard");
    }
  }, [session, isOwner, isViewer, page, dispatch]);

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
    [companies],
  );

  // company dropdowns are always A to Z
  const companyOptions = useMemo(
    () =>
      [...companies].sort((a, b) =>
        String(a.name).localeCompare(String(b.name), undefined, {
          sensitivity: "base",
        }),
      ),
    [companies],
  );

  // Purchases are from suppliers, sales are to customers ("Both" is in each list)
  const suppliers = useMemo(
    () => companyOptions.filter((c) => c.company_type !== "Customer"),
    [companyOptions],
  );
  const customers = useMemo(
    () => companyOptions.filter((c) => c.company_type !== "Supplier"),
    [companyOptions],
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

      if (filters.company && record.company_id !== filters.company)
        return false;
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

    const getValue = (key) => (r) => {
      if (key === "company_id") return companyMap[r.company_id];
      if (NUMERIC_KEYS.includes(key))
        return r[key] == null || r[key] === "" ? null : Number(r[key]);
      if (DATE_KEYS.includes(key)) return dayOf(r[key]) || null;
      return r[key];
    };

    out = sortRows(out, getValue(dataSort.key), dataSort, byCreated);

    return out;
  }, [rows, search, filters, dataSort, dateKey, page, companyMap]);

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
          pQty: 0,
          pTotal: 0,
          paid: 0,
          sQty: 0,
          sTotal: 0,
          received: 0,
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

    const unsorted = Object.values(byCompany)
      .filter((c) => !sCompany || c.id === sCompany)
      .filter((c) => !q || c.name.toLowerCase().includes(q))
      .map((c) => {
        const payable = c.pTotal - c.paid;
        const receivable = c.sTotal - c.received;
        return { ...c, payable, receivable, net: receivable - payable };
      });
    const out = sortRows(unsorted, (c) => c[sSort.key], sSort);

    const sum = (key) => out.reduce((n, c) => n + c[key], 0);

    return {
      rows: out,
      totals: {
        pQty: sum("pQty"),
        pTotal: sum("pTotal"),
        paid: sum("paid"),
        sQty: sum("sQty"),
        sTotal: sum("sTotal"),
        received: sum("received"),
        payable: sum("payable"),
        receivable: sum("receivable"),
        net: sum("net"),
      },
    };
  }, [
    purchasesList,
    salesList,
    paymentsList,
    companyMap,
    sCompany,
    sFrom,
    sTo,
    search,
    sSort,
  ]);

  // ===================================================
  // 10c. VEHICLE TRACKING (purchase → sale, matched by vehicle)
  // ===================================================

  const tracking = useMemo(() => {
    const purchases = purchasesList.items.map((p) => ({ ...p, _sales: [] }));
    const { rentByPurchase } = matchRents(rentsList.items, purchasesList.items);

    const sales = [...salesList.items].sort((a, b) =>
      dayOf(a.entry_date).localeCompare(dayOf(b.entry_date)),
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
          .sort((a, b) =>
            dayOf(b.entry_date).localeCompare(dayOf(a.entry_date)),
          );

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
          }),
        );
      }
    });

    orphans.forEach((s) =>
      all.push({ key: `s-${s.id}`, status: "No purchase", p: null, s }),
    );

    const q = search.trim().toLowerCase();

    const trackGet = {
      vehicle: (r) => r.p?.vehicle_number || r.s?.vehicle_number,
      pco: (r) => companyMap[r.p?.company_id],
      pdate: (r) => dayOf((r.p || r.s).entry_date),
      pqty: (r) => (r.p ? Number(r.p.quantity || 0) : null),
      prate: (r) => (r.p ? Number(r.p.rate || 0) : null),
      ptotal: (r) => (r.p ? Number(r.p.purchase_total || 0) : null),
      sco: (r) => companyMap[r.s?.company_id],
      sdate: (r) => (r.s ? dayOf(r.s.entry_date) : null),
      sqty: (r) => (r.s ? Number(r.s.quantity || 0) : null),
      srate: (r) => (r.s ? Number(r.s.rate || 0) : null),
      stotal: (r) => (r.s ? Number(r.s.gross_total || 0) : null),
      days: (r) => r.days,
      rent: (r) => (r.p ? r.rent : null),
      margin: (r) => r.margin,
      status: (r) => r.status,
    };

    const unsorted = all
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
      .map((r) => {
        const rent = r.p ? rentByPurchase[r.p.id] || 0 : 0;

        return {
          ...r,
          rent,
          // days from unload until the sale was paid (still counting if unpaid)
          days: r.s ? (alloc.sales[r.s.id]?.days ?? null) : null,
          daysPending: r.s ? Boolean(alloc.sales[r.s.id]?.pending) : false,
          // margin = sale - purchase - vehicle rent
          margin:
            r.p && r.s && r.single
              ? Number(r.s.gross_total || 0) -
                Number(r.p.purchase_total || 0) -
                rent
              : null,
        };
      });
    const rowsOut = sortRows(unsorted, trackGet[tSort.key], tSort);

    // totals: each purchase counted once even if sold in several parts
    const seen = new Set();
    const totals = {
      pQty: 0,
      pTotal: 0,
      sQty: 0,
      sTotal: 0,
      soldPurchase: 0,
      rent: 0,
      soldRent: 0,
      pending: 0,
    };

    rowsOut.forEach((r) => {
      if (r.p && !seen.has(r.p.id)) {
        seen.add(r.p.id);
        totals.pQty += Number(r.p.quantity || 0);
        totals.pTotal += Number(r.p.purchase_total || 0);
        totals.rent += r.rent;
        if (r.status === "Sold") {
          totals.soldPurchase += Number(r.p.purchase_total || 0);
          totals.soldRent += r.rent;
        }
      }

      if (r.s) {
        totals.sQty += Number(r.s.quantity || 0);
        totals.sTotal += Number(r.s.gross_total || 0);
      }

      if (r.status === "Pending") totals.pending += 1;
    });

    totals.margin = totals.sTotal - totals.soldPurchase - totals.soldRent;

    return { rows: rowsOut, totals };
  }, [
    purchasesList,
    salesList,
    rentsList,
    alloc,
    companyMap,
    tPCompany,
    tSCompany,
    tFrom,
    tTo,
    tStatus,
    tSort,
    search,
  ]);

  const trackFiltered = Boolean(
    tPCompany || tSCompany || tFrom || tTo || tStatus || search,
  );

  // ===================================================
  // 10c-2. VEHICLE RENT (rent paid per purchase vehicle)
  // ===================================================

  const rentView = useMemo(() => {
    const { linked } = matchRents(rentsList.items, purchasesList.items);
    const q = search.trim().toLowerCase();
    const rentGet = {
      entry_date: (r) => dayOf(r.entry_date),
      company: (r) => companyMap[r.company_id],
      vehicle_number: (r) => r.vehicle_number,
      paid_date: (r) => (r.paid_date ? dayOf(r.paid_date) : null),
      amount: (r) =>
        r.amount == null || r.amount === "" ? null : Number(r.amount),
      account_name: (r) => r.account_name,
      status: (r) => (isRentPaid(r) ? "Paid" : "Unpaid"),
      link: (r) => (r.isLinked ? "Linked" : "No purchase found"),
    };

    const unsorted = rentsList.items
      .filter((r) => {
        const day = dayOf(r.entry_date);

        if (rCompany && r.company_id !== rCompany) return false;
        if (rAccount && (r.account_name || "") !== rAccount) return false;
        if (rFrom && day < rFrom) return false;
        if (rTo && day > rTo) return false;
        if (rStatus && (isRentPaid(r) ? "Paid" : "Unpaid") !== rStatus)
          return false;

        if (q) {
          const text = [
            r.vehicle_number,
            r.account_name,
            companyMap[r.company_id],
          ]
            .join(" ")
            .toLowerCase();
          if (!text.includes(q)) return false;
        }

        return true;
      })
      .map((r) => ({ ...r, isLinked: Boolean(linked[r.id]) }));
    const rowsOut = sortRows(unsorted, rentGet[rSort.key], rSort, byCreated);

    const totals = {
      amount: 0,
      paid: 0,
      unpaid: 0,
      unpaidCount: 0,
      unlinked: 0,
    };

    rowsOut.forEach((r) => {
      const amount = Number(r.amount || 0);
      totals.amount += amount;

      if (isRentPaid(r)) {
        totals.paid += amount;
      } else {
        totals.unpaid += amount;
        totals.unpaidCount += 1;
      }

      if (!r.isLinked) totals.unlinked += 1;
    });

    const accounts = [
      ...new Set(rentsList.items.map((r) => r.account_name).filter(Boolean)),
    ].sort((a, b) => a.localeCompare(b));

    return { rows: rowsOut, totals, accounts };
  }, [
    rentsList,
    purchasesList,
    companyMap,
    rCompany,
    rAccount,
    rFrom,
    rTo,
    rStatus,
    rSort,
    search,
  ]);

  const rentFiltered = Boolean(
    rCompany || rAccount || rFrom || rTo || rStatus || search,
  );

  // ===================================================
  // 10c-3. LEDGER (purchases + sales + payments together)
  // ===================================================

  const ledgerView = useMemo(() => {
    const all = [
      ...purchasesList.items.map((p) => ({
        id: `P-${p.id}`,
        kind: "Purchase",
        date: p.entry_date,
        company_id: p.company_id,
        vehicle: p.vehicle_number,
        ref: p.voucher_no,
        qty: Number(p.quantity || 0),
        amount: Number(p.purchase_total || 0),
        created_at: p.created_at,
      })),
      ...salesList.items.map((x) => ({
        id: `S-${x.id}`,
        kind: "Sale",
        date: x.entry_date,
        company_id: x.company_id,
        vehicle: x.vehicle_number,
        ref: x.voucher_no,
        qty: Number(x.quantity || 0),
        amount: Number(x.gross_total || 0),
        created_at: x.created_at,
      })),
      ...paymentsList.items.map((x) => ({
        id: `M-${x.id}`,
        kind: x.direction === "paid" ? "Paid" : "Received",
        date: x.payment_date,
        company_id: x.company_id,
        vehicle: "",
        ref: x.reference,
        qty: null,
        amount: Number(x.amount || 0),
        created_at: x.created_at,
      })),
    ].map((r) => ({ ...r, company: companyMap[r.company_id] || "" }));

    const q = search.trim().toLowerCase();

    const filteredRows = all.filter((r) => {
      const d = dayOf(r.date);

      if (lCompany && r.company_id !== lCompany) return false;
      if (lType && r.kind !== lType) return false;
      if (lFrom && d < lFrom) return false;
      if (lTo && d > lTo) return false;

      if (q) {
        const text =
          `${r.company} ${r.vehicle || ""} ${r.ref || ""}`.toLowerCase();
        if (!text.includes(q)) return false;
      }

      return true;
    });

    const getters = {
      date: (r) => dayOf(r.date),
      kind: (r) => r.kind,
      company: (r) => r.company,
      vehicle: (r) => r.vehicle,
      ref: (r) => r.ref,
      qty: (r) => r.qty,
      amount: (r) => r.amount,
    };

    const rows = sortRows(filteredRows, getters[lSort.key], lSort, byCreated);

    const totals = {
      pQty: 0,
      sQty: 0,
      purchases: 0,
      sales: 0,
      paid: 0,
      received: 0,
    };

    filteredRows.forEach((r) => {
      if (r.kind === "Purchase") {
        totals.pQty += r.qty;
        totals.purchases += r.amount;
      } else if (r.kind === "Sale") {
        totals.sQty += r.qty;
        totals.sales += r.amount;
      } else if (r.kind === "Paid") {
        totals.paid += r.amount;
      } else {
        totals.received += r.amount;
      }
    });

    totals.payable = totals.purchases - totals.paid;
    totals.receivable = totals.sales - totals.received;
    // positive = you still have to receive more than you have to pay
    totals.balance = totals.receivable - totals.payable;

    return { rows, totals, all: all.length };
  }, [
    purchasesList,
    salesList,
    paymentsList,
    companyMap,
    lCompany,
    lType,
    lFrom,
    lTo,
    lSort,
    search,
  ]);

  const ledgerFiltered = Boolean(lCompany || lType || lFrom || lTo || search);

  // ===================================================
  // 10c-4. PAYMENT DUES (what customers owe / what you owe suppliers)
  // ===================================================

  const duesView = useMemo(() => {
    const map = {};
    const co = (id) =>
      (map[id] = map[id] || {
        name: companyMap[id] || "—",
        sales: 0,
        received: 0,
        purchases: 0,
        paid: 0,
      });

    salesList.items.forEach((x) => {
      co(x.company_id).sales += Number(x.gross_total || 0);
    });
    purchasesList.items.forEach((x) => {
      co(x.company_id).purchases += Number(x.purchase_total || 0);
    });
    paymentsList.items.forEach((p) => {
      const c = co(p.company_id);
      if (p.direction === "received") c.received += Number(p.amount || 0);
      else if (p.direction === "paid") c.paid += Number(p.amount || 0);
    });

    const q = search.trim().toLowerCase();
    const all = Object.values(map).filter(
      (c) => !q || c.name.toLowerCase().includes(q),
    );

    // One net balance per company, so a company that is both customer and
    // supplier appears once:
    //   net = (sales - received) - (purchases - paid)
    //   net > 0  -> they still have to pay you   (Payments due)
    //   net < 0  -> you still have to pay them   (Payments to pay)
    const withNet = all.map((c) => ({
      name: c.name,
      net: c.sales - c.received - (c.purchases - c.paid),
    }));

    const toReceive = withNet
      .filter((c) => c.net > 0.5)
      .map((c) => ({ name: c.name, amount: c.net }));
    const toPay = withNet
      .filter((c) => c.net < -0.5)
      .map((c) => ({ name: c.name, amount: -c.net }));

    const sum = (list) => list.reduce((t, c) => t + c.amount, 0);

    return {
      toReceive: sortRows(toReceive, (c) => c[dueSort.key], dueSort),
      toPay: sortRows(toPay, (c) => c[paySort.key], paySort),
      totalReceive: sum(toReceive),
      totalPay: sum(toPay),
      // export: one row per company, the two remaining balances in separate columns
      exportRows: withNet
        .map((c) => [
          c.name,
          c.net > 0.5 ? c.net : null,
          c.net < -0.5 ? -c.net : null,
        ])
        .filter((r) => r[1] !== null || r[2] !== null)
        .sort((a, b) =>
          a[0].localeCompare(b[0], undefined, { sensitivity: "base" }),
        ),
    };
  }, [
    salesList,
    purchasesList,
    paymentsList,
    companyMap,
    search,
    dueSort,
    paySort,
  ]);

  // ===================================================
  // 10c-5. UNLOAD STATUS (every sale: waiting / unloaded / short)
  // ===================================================

  const unloadView = useMemo(() => {
    const q = search.trim().toLowerCase();
    const now = today();

    const all = salesList.items.map((r) => {
      const sold = Number(r.quantity || 0);
      const got = Number(r.unload_quantity || 0);
      const status =
        got <= 0 ? "Pending" : got < sold - 0.0005 ? "Short" : "Unloaded";

      return {
        ...r,
        status,
        shortage: status === "Pending" ? null : Math.max(sold - got, 0),
        waiting:
          status === "Pending"
            ? Math.max(0, daysBetween(dayOf(r.entry_date), now))
            : null,
      };
    });

    const get = {
      entry_date: (r) => dayOf(r.entry_date),
      company: (r) => companyMap[r.company_id],
      vehicle_number: (r) => r.vehicle_number,
      voucher_no: (r) => r.voucher_no,
      quantity: (r) => Number(r.quantity || 0),
      unload_date: (r) => (r.unload_date ? dayOf(r.unload_date) : null),
      unload_quantity: (r) =>
        r.status === "Pending" ? null : Number(r.unload_quantity || 0),
      shortage: (r) => r.shortage,
      waiting: (r) => r.waiting,
      status: (r) => r.status,
    };

    const filteredRows = all.filter((r) => {
      const day = dayOf(r.entry_date);

      if (uCompany && r.company_id !== uCompany) return false;
      if (uStatus && r.status !== uStatus) return false;
      if (uFrom && day < uFrom) return false;
      if (uTo && day > uTo) return false;

      if (q) {
        const text = [r.vehicle_number, r.voucher_no, companyMap[r.company_id]]
          .join(" ")
          .toLowerCase();
        if (!text.includes(q)) return false;
      }

      return true;
    });

    const rows = sortRows(filteredRows, get[uSort.key], uSort, byCreated);

    const totals = {
      saleQty: 0,
      unloadQty: 0,
      shortage: 0,
      pending: 0,
      pendingQty: 0,
      short: 0,
      unloaded: 0,
    };

    filteredRows.forEach((r) => {
      totals.saleQty += Number(r.quantity || 0);

      if (r.status === "Pending") {
        totals.pending += 1;
        totals.pendingQty += Number(r.quantity || 0);
        return;
      }

      totals.unloadQty += Number(r.unload_quantity || 0);
      totals.shortage += r.shortage || 0;
      if (r.status === "Short") totals.short += 1;
      else totals.unloaded += 1;
    });

    return { rows, totals, all: all.length };
  }, [salesList, companyMap, uCompany, uStatus, uFrom, uTo, uSort, search]);

  const unloadFiltered = Boolean(uCompany || uStatus || uFrom || uTo || search);

  // ===================================================
  // 10d. EXPORT (Excel / PDF) — exports exactly what is on screen
  // ===================================================

  function buildExport(which) {
    const day = (v) => (v ? dayOf(v) : "");
    const name = (id) => companyMap[id] || "";
    const sumOf = (list, fn) =>
      list.reduce((t, r) => t + Number(fn(r) || 0), 0);

    // ---- Vehicle tracking
    if (page === TRACK) {
      const parts = [];
      if (tPCompany) parts.push(`Purchase company: ${name(tPCompany)}`);
      if (tSCompany) parts.push(`Sale company: ${name(tSCompany)}`);
      if (tFrom) parts.push(`From ${tFrom}`);
      if (tTo) parts.push(`To ${tTo}`);
      if (tStatus) parts.push(`Status: ${tStatus}`);
      if (search) parts.push(`Search: ${search}`);

      const t = tracking.totals;

      return {
        title: "Vehicle Tracking",
        filterText: parts.join(", "),
        headers: [
          "Vehicle",
          "Purchase company",
          "Purchase date",
          "Purchase qty (qtl)",
          "Purchase rate",
          "Purchase total",
          "Sale company",
          "Sale date",
          "Sale qty (qtl)",
          "Sale rate",
          "Sale total",
          "Days",
          "Vehicle rent",
          "Margin",
          "Status",
        ],
        kinds: [
          null,
          null,
          null,
          "qty",
          "money",
          "money",
          null,
          null,
          "qty",
          "money",
          "money",
          "int",
          "money",
          "money",
          null,
        ],
        rows: tracking.rows.map((r) => [
          r.p?.vehicle_number || r.s?.vehicle_number || "",
          r.p ? name(r.p.company_id) : "",
          r.p ? day(r.p.entry_date) : "",
          r.p ? Number(r.p.quantity || 0) : null,
          r.p && r.p.rate != null ? Number(r.p.rate) : null,
          r.p ? Number(r.p.purchase_total || 0) : null,
          r.s ? name(r.s.company_id) : "",
          r.s ? day(r.s.entry_date) : "",
          r.s ? Number(r.s.quantity || 0) : null,
          r.s && r.s.rate != null ? Number(r.s.rate) : null,
          r.s ? Number(r.s.gross_total || 0) : null,
          r.days,
          r.rent || null,
          r.margin,
          r.status === "No purchase" ? "No purchase found" : r.status,
        ]),
        totalsRow: [
          `Total (${tracking.rows.length} records)`,
          "",
          "",
          t.pQty,
          null,
          t.pTotal,
          "",
          "",
          t.sQty,
          null,
          t.sTotal,
          null,
          t.rent,
          t.margin,
          `${t.pending} pending`,
        ],
      };
    }

    // ---- Payment dues: one list at a time (chosen in the export window)
    if (page === DUES) {
      const isDue = which !== "pay";
      const list = isDue ? duesView.toReceive : duesView.toPay;
      const total = isDue ? duesView.totalReceive : duesView.totalPay;

      return {
        title: isDue ? "Payments Due" : "Payments To Pay",
        filterText: search ? `Search: ${search}` : "",
        headers: ["Company", "Remaining balance"],
        kinds: [null, "money"],
        rows: list.map((c) => [c.name, c.amount]),
        totalsRow: [`Total (${list.length} companies)`, total],
      };
    }

    // ---- Unload status
    if (page === UNLOAD) {
      const parts = [];
      if (uCompany) parts.push(`Customer: ${name(uCompany)}`);
      if (uStatus) parts.push(`Status: ${uStatus}`);
      if (uFrom) parts.push(`From ${uFrom}`);
      if (uTo) parts.push(`To ${uTo}`);
      if (search) parts.push(`Search: ${search}`);

      const t = unloadView.totals;

      return {
        title: "Unload Status",
        filterText: parts.join(", "),
        headers: [
          "Sale date",
          "Customer",
          "Vehicle",
          "Voucher no.",
          "Sale qty (qtl)",
          "Unload date",
          "Unload qty (qtl)",
          "Shortage (qtl)",
          "Waiting (days)",
          "Status",
        ],
        kinds: [null, null, null, null, "qty", null, "qty", "qty", "int", null],
        rows: unloadView.rows.map((r) => [
          day(r.entry_date),
          name(r.company_id),
          r.vehicle_number || "",
          r.voucher_no || "",
          Number(r.quantity || 0),
          day(r.unload_date),
          r.status === "Pending" ? null : Number(r.unload_quantity || 0),
          r.shortage,
          r.waiting,
          r.status,
        ]),
        totalsRow: [
          `Total (${unloadView.rows.length} records)`,
          "",
          "",
          "",
          t.saleQty,
          "",
          t.unloadQty,
          t.shortage,
          null,
          `${t.pending} pending`,
        ],
      };
    }

    // ---- Ledger
    if (page === LEDGER) {
      const parts = [];
      if (lCompany) parts.push(`Company: ${name(lCompany)}`);
      if (lType)
        parts.push(
          `Type: ${lType === "Paid" ? "Payment paid" : lType === "Received" ? "Payment received" : lType}`,
        );
      if (lFrom) parts.push(`From ${lFrom}`);
      if (lTo) parts.push(`To ${lTo}`);
      if (search) parts.push(`Search: ${search}`);

      const t = ledgerView.totals;

      return {
        title: "Ledger",
        filterText: parts.join(", "),
        headers: [
          "Date",
          "Type",
          "Company",
          "Vehicle",
          "Voucher / reference",
          "Qty (qtl)",
          "Total",
        ],
        kinds: [null, null, null, null, null, "qty", "money"],
        rows: ledgerView.rows.map((r) => [
          day(r.date),
          r.kind === "Paid"
            ? "Payment paid"
            : r.kind === "Received"
              ? "Payment received"
              : r.kind,
          r.company,
          r.vehicle || "",
          r.ref || "",
          r.qty,
          r.amount,
        ]),
        summary: [
          ["Purchase qty (qtl)", t.pQty, "qty"],
          ["Sale qty (qtl)", t.sQty, "qty"],
          ["Total purchases", t.purchases, "money"],
          ["Total sales", t.sales, "money"],
          ["Total paid", t.paid, "money"],
          ["Total received", t.received, "money"],
          ["To pay", t.payable, "money"],
          ["To receive", t.receivable, "money"],
          ["Remaining balance", t.balance, "money"],
        ],
      };
    }

    // ---- Vehicle rent
    if (page === RENT) {
      const parts = [];
      if (rCompany) parts.push(`Purchase company: ${name(rCompany)}`);
      if (rAccount) parts.push(`Account: ${rAccount}`);
      if (rFrom) parts.push(`From ${rFrom}`);
      if (rTo) parts.push(`To ${rTo}`);
      if (rStatus) parts.push(`Status: ${rStatus}`);
      if (search) parts.push(`Search: ${search}`);

      const t = rentView.totals;

      return {
        title: "Vehicle Rent",
        filterText: parts.join(", "),
        headers: [
          "Purchase date",
          "Purchase company",
          "Vehicle",
          "Paid date",
          "Rent amount",
          "Account name",
          "Status",
        ],
        kinds: [null, null, null, null, "money", null, null],
        rows: rentView.rows.map((r) => [
          day(r.entry_date),
          name(r.company_id),
          r.vehicle_number || "",
          day(r.paid_date),
          r.amount == null || r.amount === "" ? null : Number(r.amount),
          r.account_name || "",
          isRentPaid(r) ? "Paid" : "Unpaid",
        ]),
        totalsRow: [
          `Total (${rentView.rows.length} records)`,
          "",
          "",
          "",
          t.amount,
          "",
          `${t.unpaidCount} unpaid`,
        ],
        summary: [
          ["Rent paid", t.paid, "money"],
          ["Rent not yet paid", t.unpaid, "money"],
          ["Total rent", t.amount, "money"],
        ],
      };
    }

    // ---- Company summary
    if (page === SUMMARY) {
      const parts = [];
      if (sCompany) parts.push(`Company: ${name(sCompany)}`);
      if (sFrom) parts.push(`From ${sFrom}`);
      if (sTo) parts.push(`To ${sTo}`);

      const t = summary.totals;

      return {
        title: "Company Summary",
        filterText: parts.join(", "),
        headers: [
          "Company",
          "Purchase qty (qtl)",
          "Purchase total",
          "Paid",
          "Payable due",
          "Sales qty (qtl)",
          "Sales total",
          "Received",
          "Receivable due",
          "Net balance",
        ],
        kinds: [
          null,
          "qty",
          "money",
          "money",
          "money",
          "qty",
          "money",
          "money",
          "money",
          "money",
        ],
        rows: summary.rows.map((c) => [
          c.name,
          c.pQty,
          c.pTotal,
          c.paid,
          c.payable,
          c.sQty,
          c.sTotal,
          c.received,
          c.receivable,
          c.net,
        ]),
        totalsRow: [
          "Total",
          t.pQty,
          t.pTotal,
          t.paid,
          t.payable,
          t.sQty,
          t.sTotal,
          t.received,
          t.receivable,
          t.net,
        ],
      };
    }

    // ---- Purchases / Sales / Payments (current filters + search)
    const parts = [];
    if (filters.company) parts.push(`Company: ${name(filters.company)}`);
    if (filters.from) parts.push(`From ${filters.from}`);
    if (filters.to) parts.push(`To ${filters.to}`);
    if (page === "Payments" && filters.direction) {
      parts.push(`Direction: ${filters.direction}`);
    }
    if (search) parts.push(`Search: ${search}`);

    if (page === "Payments") {
      return {
        title: "Payments",
        filterText: parts.join(", "),
        headers: ["Date", "Company", "Direction", "Amount", "Reference"],
        kinds: [null, null, null, "money", null],
        rows: filtered.map((r) => [
          day(r.payment_date),
          name(r.company_id),
          r.direction === "received"
            ? "Received"
            : r.direction === "paid"
              ? "Paid"
              : r.direction || "",
          Number(r.amount || 0),
          r.reference || "",
        ]),
        summary: [
          ["Payments received", totals.received, "money"],
          ["Payments paid", totals.paid, "money"],
          ["Net (received - paid)", totals.received - totals.paid, "money"],
          ["Records", filtered.length, "int"],
        ],
      };
    }

    const keys = columns[page];
    const kindOf = (key) =>
      key === "quantity"
        ? "qty"
        : key === "pay_days"
          ? "int"
          : ["rate", "gross_total", "purchase_total", "order_total"].includes(
                key,
              )
            ? "money"
            : null;

    const cellOf = (r, key) => {
      if (key === "company_id") return name(r.company_id);
      if (DATE_KEYS.includes(key)) return day(r[key]);
      if (key === "pay_days") return r.pay_days ?? null;
      if (kindOf(key))
        return r[key] == null || r[key] === "" ? null : Number(r[key]);
      return r[key] ?? "";
    };

    const totalKey = TOTAL_KEY[page];

    return {
      title: PAGE_LABEL[page] || page,
      filterText: parts.join(", "),
      headers: keys.map((k) =>
        (titleMap[k] || k.replaceAll("_", " ")).replace("₹", "Rs."),
      ),
      kinds: keys.map(kindOf),
      rows: filtered.map((r) => keys.map((k) => cellOf(r, k))),
      totalsRow: keys.map((k, i) =>
        i === 0
          ? `Total (${filtered.length} records)`
          : k === "quantity"
            ? totals.quantity
            : k === totalKey
              ? totals.amount
              : "",
      ),
    };
  }

  async function runExport(type, which) {
    setExporting(true);
    setError("");

    try {
      const spec = buildExport(which);
      if (biz) spec.title = `${spec.title} - ${biz}`;

      // the company picked in the page filter is used in the file name
      const companyId =
        page === TRACK
          ? tPCompany || tSCompany
          : page === UNLOAD
            ? uCompany
            : page === LEDGER
              ? lCompany
              : page === RENT
                ? rCompany
                : page === SUMMARY
                  ? sCompany
                  : filters?.company;
      spec.company = companyMap[companyId] || "";

      if (page === TRACK && !isOwner) {
        const keep = spec.headers.map(
          (h) => h !== "Vehicle rent" && h !== "Margin",
        );
        const pick = (arr) => arr.filter((_, i) => keep[i]);
        spec.headers = pick(spec.headers);
        spec.kinds = pick(spec.kinds);
        spec.rows = spec.rows.map(pick);
        if (spec.totalsRow) spec.totalsRow = pick(spec.totalsRow);
      }
      if (type === "pdf") await exportPdf(spec);
      else await exportExcel(spec);
    } catch (err) {
      setError(
        `Export failed: ${getErrorMessage(err)}. ` +
          "If this is the first time, run: npm install xlsx jspdf jspdf-autotable",
      );
    } finally {
      setExporting(false);
    }
  }

  const exportButtons = (
    <div className="export-actions">
      <button
        type="button"
        className="secondary"
        disabled={exporting}
        onClick={() =>
          page === DUES ? setDueExport("excel") : runExport("excel")
        }
        title="Download the filtered data as Excel"
      >
        <FileSpreadsheet size={14} />
        Excel
      </button>

      <button
        type="button"
        className="secondary"
        disabled={exporting}
        onClick={() => (page === DUES ? setDueExport("pdf") : runExport("pdf"))}
        title="Download the filtered data as PDF"
      >
        <FileText size={14} />
        PDF
      </button>
    </div>
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

  // open / close the sidebar (slides in on phones, collapses on desktop)
  function toggleMenu() {
    if (window.matchMedia("(max-width: 900px)").matches) {
      setMobile((open) => !open);
    } else {
      setWide((w) => !w);
    }
  }

  // close button inside the open sidebar
  function closeMenu() {
    if (window.matchMedia("(max-width: 900px)").matches) setMobile(false);
    else setWide(false);
  }

  // go to a page of a business folder (used by the tab strip)
  function goToPage(name, business) {
    dispatch(setBusiness(business));
    setBiz(business);
    setPage(name);
    setSearch("");
    dispatch(clearError());
    setMobile(false);
  }

  async function logout() {
    setError("");

    const { error } = await auth.auth.signOut();

    if (error) {
      setError(error.message);
      return;
    }

    // the next sign-in starts on the Dashboard
    dispatch(setBusiness(""));
    setBiz("");
    setPage("Dashboard");
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
      ["quantity", "Quantity (qtl)", "number"],
      ["rate", "Rate", "number"],
      ["purchase_total", "Purchase total (₹)", "number"],
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
      ["payment_due_date", "Payment due date", "date"],
      ["unload_date", "Unload date", "date"],
      [
        "unload_quantity",
        "Unload quantity (qtl) - leave empty if not unloaded yet",
        "number",
      ],
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

    Orders: [
      ["company_id", "Supplier", "company", true],
      ["order_date", "Order date", "date", true],
      ["po_number", "PO number", "text"],
      ["quantity", "Quantity (qtl)", "number", true],
      ["rate", "Rate (₹/qtl)", "number", true],
      [
        "order_total",
        "Order total (₹) - leave empty to use quantity x rate",
        "number",
      ],
      ["delivery_date", "Expected delivery date", "date"],
      ["status", "Status", "select", true],
      ["notes", "Notes", "text"],
    ],

    Rents: [
      ["company_id", "Purchase company", "company", true],
      ["entry_date", "Purchase date", "date", true],
      ["vehicle_number", "Vehicle number", "text", true],
      ["paid_date", "Paid date", "date"],
      ["amount", "Rent amount (₹)", "number"],
      ["account_name", "Account name", "text"],
      ["notes", "Notes", "text"],
    ],
  };

  // ===================================================
  // 14. TABLE COLUMNS
  // ===================================================

  const columns = {
    Companies: ["name", "company_type", "credit_days", "phone"],

    Purchases: [
      "entry_date",
      "company_id",
      "voucher_no",
      "vehicle_number",
      "quantity",
      "rate",
      "purchase_total",
      "paid_on",
    ],

    Orders: [
      "order_date",
      "company_id",
      "po_number",
      "quantity",
      "rate",
      "order_total",
      "delivery_date",
      "status",
    ],

    Sales: [
      "entry_date",
      "company_id",
      "voucher_no",
      "vehicle_number",
      "quantity",
      "rate",
      "gross_total",
      "pay_received",
      "pay_days",
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
    rate: "Rate (₹/qtl)",
    company_id: "Company",
    entry_date: "Date",
    payment_date: "Date",
    gross_total: "Sales total",
    purchase_total: "Purchase total",
    credit_days: "Credit days",
    vehicle_number: "Vehicle",
    pay_received: "Payment received",
    pay_days: "Days",
    paid_on: "Paid on",
    order_date: "Order date",
    po_number: "PO no",
    order_total: "Order total",
    delivery_date: "Delivery date",
    status: "Status",
  };

  // ===================================================
  // 15. TABLE DISPLAY FORMAT
  // ===================================================

  function display(key, value, record) {
    if (key === "pay_received" || key === "paid_on") {
      return value ? dayOf(value) : "—";
    }

    if (key === "pay_days") {
      if (value == null) return "—";
      return `${value} ${value === 1 ? "day" : "days"}${record?.pay_pending ? " · pending" : ""}`;
    }

    if (key === "company_id") {
      return companyMap[value] || "—";
    }

    if (
      ["gross_total", "purchase_total", "amount", "order_total"].includes(key)
    ) {
      return money(value);
    }

    if (key === "rate") {
      return value == null || value === "" ? "—" : money(value);
    }

    if (key === "quantity" || key === "unload_quantity") {
      return value == null || value === "" ? "—" : `${qty(value)} qtl`;
    }

    return value ?? "—";
  }

  // ===================================================
  // 16. SAVE / UPDATE RECORD
  // ===================================================

  // Keeps Vehicle Rent in step with Purchases: a new purchase with a vehicle
  // number gets its rent row (amount can be filled in later); editing a
  // purchase updates the rent row that belonged to it. Owner only, because
  // vehicle rent data is owner only.
  async function syncRentForPurchase(body, previous) {
    const sameVehicle = (r, v) =>
      normVehicle(r.vehicle_number) === normVehicle(v);
    const sameBill = (r, b) =>
      sameVehicle(r, b.vehicle_number) &&
      r.company_id === b.company_id &&
      dayOf(r.entry_date) === dayOf(b.entry_date);

    const rents = rentsList.items;
    const rentBody = {
      company_id: body.company_id,
      entry_date: body.entry_date,
      vehicle_number: body.vehicle_number,
    };

    if (previous) {
      const old = previous.vehicle_number
        ? rents.find((r) => sameBill(r, previous))
        : null;
      if (old) {
        return dispatch(
          saveRecord({
            api,
            page: "Rents",
            id: old.id,
            body: rentBody,
            business: biz,
          }),
        ).unwrap();
      }
    }

    if (rents.some((r) => sameBill(r, body))) return { exists: true };

    return dispatch(
      saveRecord({ api, page: "Rents", body: rentBody, business: biz }),
    ).unwrap();
  }

  async function save(event) {
    event.preventDefault();

    setError("");
    setBusy(true);

    try {
      const formData = new FormData(event.currentTarget);

      const body = Object.fromEntries(formData.entries());

      const numericFields = [
        "order_total",
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
        "order_total",
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

      // order total defaults to quantity x rate
      if (dataPage === "Orders" && !Number(body.order_total)) {
        body.order_total = Number(body.quantity || 0) * Number(body.rate || 0);
      }

      const result = await dispatch(
        saveRecord({
          api,
          page: dataPage,
          id: editing?.id,
          body,
          business: biz,
        }),
      ).unwrap();

      // purchase saved -> also create / update its vehicle rent row
      const lines = [savedLine(result, dataPage)];
      let tone = "ok";

      if (dataPage === "Purchases" && isOwner && body.vehicle_number) {
        try {
          const rent = await syncRentForPurchase(body, editing);
          lines.push(
            rent?.exists
              ? "Vehicle Rent table already has this vehicle and date - no duplicate added"
              : savedLine(rent, "Rents"),
          );
        } catch (rentErr) {
          tone = "error";
          lines.push(
            `Vehicle Rent entry NOT saved: ${getErrorMessage(rentErr)}`,
          );
        }
      }

      if (dataPage === "Sales") {
        lines.push(
          "Unload Status table now lists this sale (" +
            (Number(body.unload_quantity || 0) > 0
              ? "unload details saved"
              : "status: Pending") +
            ")",
        );
      }

      if (!result.verified) tone = "error";

      setNotice({
        tone,
        title: editing ? "Record updated" : "New entry added",
        lines,
      });

      setModal(false);
      setEditing(null);
    } catch (err) {
      setError(getErrorMessage(err));
      setNotice({
        tone: "error",
        title: "Not saved",
        lines: [getErrorMessage(err)],
      });
    } finally {
      setBusy(false);
    }
  }

  // ===================================================
  // 17. DELETE RECORD
  // ===================================================

  async function saveUnload(event) {
    event.preventDefault();
    if (!unloadEdit) return;

    setError("");
    setBusy(true);

    try {
      const form = new FormData(event.currentTarget);
      const raw = form.get("unload_quantity");
      const quantity = raw === "" || raw == null ? 0 : Number(raw);

      const result = await dispatch(
        saveRecord({
          api,
          page: "Sales",
          id: unloadEdit.id,
          body: {
            unload_quantity: quantity,
            unload_date: quantity > 0 ? form.get("unload_date") || null : null,
          },
          business: biz,
        }),
      ).unwrap();

      setUnloadEdit(null);
      setNotice({
        tone: result.verified ? "ok" : "error",
        title: "Unload updated",
        lines: [
          `Unload details saved in the Sales / Unload Status table - ${
            result.verified
              ? "server confirmed ✓"
              : "could not be confirmed yet"
          }`,
        ],
      });
    } catch (err) {
      setError(getErrorMessage(err));
      setNotice({
        tone: "error",
        title: "Not saved",
        lines: [getErrorMessage(err)],
      });
    } finally {
      setBusy(false);
    }
  }

  async function remove(id) {
    if (!window.confirm("Are you sure you want to delete this record?")) {
      return;
    }

    setError("");
    setBusy(true);

    try {
      await dispatch(
        deleteRecord({ api, page: dataPage, id, business: biz }),
      ).unwrap();
      setNotice({
        tone: "ok",
        title: "Record deleted",
        lines: [
          `${RECORD_LABEL[dataPage]} removed from the ${TABLE_NAME[dataPage]} table`,
        ],
      });
    } catch (err) {
      setError(getErrorMessage(err));
      refresh(true);
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
          <div className="brand-mark">MS</div>
          <h2>Loading Manchana Srinivas...</h2>
          <p className="muted">Checking your login session.</p>
        </div>
      </main>
    );
  }

  // ===================================================
  // 19. LOGIN SCREEN
  // ===================================================

  if (booting) {
    const pct = Math.round(
      (bootProgress.done / Math.max(bootProgress.total, 1)) * 100,
    );

    return (
      <main className="login-wrap">
        <div className="login-card boot-card" role="status" aria-live="polite">
          <div className="boot-spinner">
            <div className="brand-mark">MS</div>
          </div>

          <h2>Loading your data...</h2>

          <p className="muted">
            {bootSlow
              ? "The server is waking up. This can take up to a minute."
              : "Getting companies, purchases, sales, payments and rent ready."}
          </p>

          <div
            className="boot-bar"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={pct}
          >
            <span style={{ width: `${pct}%` }} />
          </div>
        </div>
      </main>
    );
  }

  if (!session) {
    return (
      <main className="login-wrap">
        <form className="login-card" onSubmit={login}>
          <div className="brand-mark">MS</div>

          <p className="eyebrow">MANCHANA SRINIVAS</p>

          <h1>Welcome back</h1>

          <p className="muted">Sign in to manage your business records.</p>

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
    <div className={`app-shell ${wide ? "sidebar-wide" : ""}`}>
      {/* SIDEBAR */}

      {mobile && (
        <div
          className="sidebar-scrim"
          onClick={() => setMobile(false)}
          aria-hidden="true"
        />
      )}

      <aside className={`sidebar ${mobile ? "open" : ""}`}>
        <button
          type="button"
          className="sidebar-close"
          onClick={closeMenu}
          title="Close menu"
          aria-label="Close menu"
        >
          <X size={18} />
        </button>

        <div className="brand">
          <div className="brand-mark">MS</div>

          <div>
            <b>Manchana Srinivas</b>
            <small>MANAGEMENT SYSTEM</small>
          </div>
        </div>

        <div className="nav-label">WORKSPACE</div>

        {(() => {
          const goTo = (name, business = "") => {
            // switch the cached data first so the old business never flashes
            setOpenFolders({});
            dispatch(setBusiness(business));
            setBiz(business);
            setPage(name);
            setSearch("");
            dispatch(clearError());
            setMobile(false);
          };

          return (
            <>
              {nav
                .filter(([n]) => !(isViewer && VIEWER_HIDDEN_PAGES.includes(n)))
                .map(([name, Icon]) => (
                  <button
                    key={name}
                    className={`nav-item ${!biz && page === name ? "active" : ""}`}
                    onClick={() => goTo(name)}
                    title={PAGE_LABEL[name] || name}
                  >
                    <Icon size={20} />
                    <span className="nav-text">{PAGE_LABEL[name] || name}</span>
                  </button>
                ))}

              {folders.map((folder) => {
                const open =
                  openFolders[folder.name] ?? (wide && biz === folder.name);
                const items = folder.items.filter(
                  ([n]) => isOwner || !OWNER_ONLY_PAGES.includes(n),
                );
                const holdsPage = biz === folder.name;
                const FolderIcon = open ? FolderOpen : Folder;

                return (
                  <div className="nav-folder" key={folder.name}>
                    <button
                      type="button"
                      className={`nav-item nav-folder-btn ${holdsPage ? "has-active" : ""}`}
                      aria-expanded={open}
                      title={folder.name}
                      onClick={(e) => {
                        const top = e.currentTarget.getBoundingClientRect().top;
                        setFlyTop(
                          Math.max(
                            8,
                            Math.min(top - 6, window.innerHeight - 340),
                          ),
                        );
                        setOpenFolders((f) =>
                          wide
                            ? { ...f, [folder.name]: !open }
                            : { [folder.name]: !open },
                        );
                      }}
                    >
                      <FolderIcon size={20} />
                      <span className="nav-folder-name">{folder.name}</span>
                      <ChevronDown
                        size={15}
                        className={`nav-chevron ${open ? "open" : ""}`}
                      />
                    </button>

                    {open && (
                      <div className="nav-sub" style={{ top: flyTop }}>
                        {items.length ? (
                          items.map(([name, Icon]) => (
                            <button
                              key={name}
                              className={`nav-item ${
                                biz === folder.name && page === name
                                  ? "active"
                                  : ""
                              }`}
                              onClick={() => goTo(name, folder.name)}
                            >
                              <Icon size={17} />
                              <span className="nav-text">
                                {PAGE_LABEL[name] || name}
                              </span>
                            </button>
                          ))
                        ) : (
                          <p className="nav-empty">No pages yet</p>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </>
          );
        })()}
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

          <div className="topbar-title">
            <b>{PAGE_LABEL[page] || page}</b>
            {biz && <span className="muted">{biz}</span>}
          </div>

          {page !== "Dashboard" && (
            <div className="searchbox top-search">
              <Search size={16} />

              <input
                placeholder={
                  page === RENT
                    ? "Search vehicle / account..."
                    : page === TRACK
                      ? "Search vehicle / voucher..."
                      : page === SUMMARY
                        ? "Search company..."
                        : page === LEDGER
                          ? "Search company / vehicle / voucher..."
                          : "Search records..."
                }
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
          )}

          <div className="top-actions">
            {!isViewer &&
              page !== "Dashboard" &&
              page !== SUMMARY &&
              page !== LEDGER &&
              page !== UNLOAD &&
              page !== DUES && (
                <button
                  className="primary"
                  aria-label={`Add ${RECORD_LABEL[dataPage]}`}
                  onClick={() => {
                    setEditing(null);
                    setError("");
                    setModal(true);
                  }}
                >
                  <Plus size={16} />
                  <span className="add-text">Add {RECORD_LABEL[dataPage]}</span>
                </button>
              )}

            <span className="top-avatar" title={session.user.email}>
              {(session.user.email || "?").charAt(0).toUpperCase()}
            </span>

            <button
              className="icon-btn"
              onClick={() => refresh(true)}
              title="Refresh"
              disabled={busy || Boolean(list?.loading) || summaryLoading}
            >
              <RefreshCw size={17} />
            </button>

            <button
              className="icon-btn"
              onClick={logout}
              title="Sign out"
              aria-label="Sign out"
            >
              <LogOut size={17} />
            </button>
          </div>
        </header>

        {/* ACCOUNTS TAB STRIP: menu + Ledger, Payment Dues, Vehicle Tracking on one line */}

        <nav className="subtabs" aria-label="Accounts">
          <button
            type="button"
            className="subtab subtab-menu"
            onClick={toggleMenu}
            aria-expanded={wide}
            title={wide ? "Show icons only" : "Show menu names"}
          >
            <Menu size={18} />
            <span>Menu</span>
          </button>

          <span className="subtabs-sep" aria-hidden="true" />

          {[LEDGER, DUES, UNLOAD, TRACK]
            .filter(
              (name) => canSeeFinance || name === TRACK || name === UNLOAD,
            )
            .map((name) => {
              const folder = biz || folders[0].name;
              const active = page === name && biz === folder;

              return (
                <button
                  key={name}
                  type="button"
                  className={`subtab ${active ? "active" : ""}`}
                  aria-current={active ? "page" : undefined}
                  onClick={() => goToPage(name, folder)}
                >
                  {PAGE_LABEL[name] || name}
                </button>
              );
            })}
        </nav>

        {/* PAGE CONTENT */}

        <section className="content">
          {/* ERROR MESSAGE */}

          {(error || storeError) && (
            <div className="error">{error || storeError}</div>
          )}

          {/* LOADING */}

          {busy && <p className="muted">Processing request...</p>}

          {/* DASHBOARD */}

          {page === "Dashboard" ? (
            <Dashboard
              api={api}
              canSeeFinance={canSeeFinance}
              companyMap={companyMap}
              onOpen={(name, business) =>
                goToPage(name, business || folders[0].name)
              }
            />
          ) : page === TRACK ? (
            /* VEHICLE TRACKING */

            <div className="panel fill">
              <div className="table-toolbar">
                <div>
                  <h3>Vehicle tracking</h3>

                  <p className="muted">
                    {trackFiltered
                      ? `${tracking.rows.length} records (filtered)`
                      : `${tracking.rows.length} records`}
                    {summaryLoading && !summaryFirstLoad && " · refreshing…"}
                  </p>
                </div>

                <div className="filter-bar">
                  <label>
                    Purchase company
                    <select
                      value={tPCompany}
                      onChange={(e) => setTPCompany(e.target.value)}
                    >
                      <option value="">All companies</option>
                      {suppliers.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
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
                      {customers.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
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

                {exportButtons}
              </div>

              {summaryFirstLoad ? (
                <p className="muted pad">Loading records...</p>
              ) : (
                <div className="table-wrap">
                  <table className="summary-table">
                    <thead>
                      <tr>
                        <SortTh
                          label="Vehicle"
                          k="vehicle"
                          kind="text"
                          sort={tSort}
                          onSort={sortT}
                        />
                        <SortTh
                          label="Purchase company"
                          k="pco"
                          kind="text"
                          sort={tSort}
                          onSort={sortT}
                        />
                        <SortTh
                          label="Purchase date"
                          k="pdate"
                          kind="date"
                          sort={tSort}
                          onSort={sortT}
                        />
                        <SortTh
                          label="Qty (qtl)"
                          k="pqty"
                          kind="num"
                          right
                          sort={tSort}
                          onSort={sortT}
                        />
                        <SortTh
                          label="Purchase rate"
                          k="prate"
                          kind="num"
                          right
                          sort={tSort}
                          onSort={sortT}
                          title="Purchase rate per qtl"
                        />
                        <SortTh
                          label="Purchase total"
                          k="ptotal"
                          kind="num"
                          right
                          sort={tSort}
                          onSort={sortT}
                        />
                        <SortTh
                          label="Sale company"
                          k="sco"
                          kind="text"
                          sort={tSort}
                          onSort={sortT}
                        />
                        <SortTh
                          label="Sale date"
                          k="sdate"
                          kind="date"
                          sort={tSort}
                          onSort={sortT}
                        />
                        <SortTh
                          label="Qty (qtl)"
                          k="sqty"
                          kind="num"
                          right
                          sort={tSort}
                          onSort={sortT}
                        />
                        <SortTh
                          label="Sale rate"
                          k="srate"
                          kind="num"
                          right
                          sort={tSort}
                          onSort={sortT}
                          title="Sale rate per qtl"
                        />
                        <SortTh
                          label="Sale total"
                          k="stotal"
                          kind="num"
                          right
                          sort={tSort}
                          onSort={sortT}
                        />
                        <SortTh
                          label="Days"
                          k="days"
                          kind="num"
                          right
                          sort={tSort}
                          onSort={sortT}
                          title="Days from unload to payment received (still counting while unpaid)"
                        />
                        {isOwner && (
                          <>
                            <SortTh
                              label="Rent"
                              k="rent"
                              kind="num"
                              right
                              sort={tSort}
                              onSort={sortT}
                            />
                            <SortTh
                              label="Margin"
                              k="margin"
                              kind="num"
                              right
                              sort={tSort}
                              onSort={sortT}
                              title="Sale total - purchase total - vehicle rent"
                            />
                          </>
                        )}
                        <SortTh
                          label="Status"
                          k="status"
                          kind="text"
                          sort={tSort}
                          onSort={sortT}
                        />
                      </tr>
                    </thead>

                    <tbody>
                      {tracking.rows.map((r) => (
                        <tr key={r.key}>
                          <td>
                            <b>
                              {r.p?.vehicle_number ||
                                r.s?.vehicle_number ||
                                "—"}
                            </b>
                          </td>
                          <td>
                            {r.p ? companyMap[r.p.company_id] || "—" : "—"}
                          </td>
                          <td>{r.p ? dayOf(r.p.entry_date) : "—"}</td>
                          <td className="num">
                            {r.p ? qty(r.p.quantity) : "—"}
                          </td>
                          <td className="num">
                            {r.p && r.p.rate != null ? money(r.p.rate) : "—"}
                          </td>
                          <td className="num">
                            {r.p ? money(r.p.purchase_total) : "—"}
                          </td>
                          <td>
                            {r.s ? companyMap[r.s.company_id] || "—" : "—"}
                          </td>
                          <td>{r.s ? dayOf(r.s.entry_date) : "—"}</td>
                          <td className="num">
                            {r.s ? qty(r.s.quantity) : "—"}
                          </td>
                          <td className="num">
                            {r.s && r.s.rate != null ? money(r.s.rate) : "—"}
                          </td>
                          <td className="num">
                            {r.s ? money(r.s.gross_total) : "—"}
                          </td>
                          <td className="num">
                            {r.days == null
                              ? "—"
                              : `${r.days}${r.daysPending ? " · pending" : ""}`}
                          </td>
                          {isOwner && (
                            <>
                              <td className="num">
                                {r.rent ? money(r.rent) : "—"}
                              </td>
                              <td
                                className={`num ${r.margin > 0 ? "due-in" : r.margin < 0 ? "due-out" : ""}`}
                              >
                                {r.margin === null ? "—" : money(r.margin)}
                              </td>
                            </>
                          )}
                          <td>
                            <span
                              className={`status-pill ${r.status === "Sold" ? "sold" : r.status === "Pending" ? "pending" : "orphan"}`}
                            >
                              {r.status === "No purchase"
                                ? "No purchase found"
                                : r.status}
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
                <div className="totals-bar one-line">
                  <div className="totals-label">
                    {trackFiltered ? "Filtered totals" : "Totals"}
                    <small>
                      {tracking.rows.length} records · {tracking.totals.pending}{" "}
                      pending
                    </small>
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
                    {isOwner && (
                      <>
                        <div>
                          <span>Vehicle rent</span>
                          <b>{money(tracking.totals.rent)}</b>
                        </div>
                        <div>
                          <span>Margin (sold, after rent)</span>
                          <b>{money(tracking.totals.margin)}</b>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>
          ) : page === RENT ? (
            /* VEHICLE RENT */

            <div className="panel fill">
              <div className="table-toolbar">
                <div>
                  <h3>Vehicle rent</h3>

                  <p className="muted">
                    {rentFiltered
                      ? `${rentView.rows.length} of ${rentsList.items.length} records`
                      : `${rentsList.items.length} records`}
                    {rentsList.loading && rentsList.loaded && " · refreshing…"}
                  </p>
                </div>

                <div className="filter-bar">
                  <label>
                    Purchase company
                    <select
                      value={rCompany}
                      onChange={(e) => setRCompany(e.target.value)}
                    >
                      <option value="">All companies</option>
                      {companyOptions.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label>
                    Account name
                    <select
                      value={rAccount}
                      onChange={(e) => setRAccount(e.target.value)}
                    >
                      <option value="">All accounts</option>
                      {rentView.accounts.map((a) => (
                        <option key={a} value={a}>
                          {a}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label>
                    From
                    <input
                      type="date"
                      value={rFrom}
                      max={rTo || undefined}
                      onChange={(e) => setRFrom(e.target.value)}
                    />
                  </label>

                  <label>
                    To
                    <input
                      type="date"
                      value={rTo}
                      min={rFrom || undefined}
                      onChange={(e) => setRTo(e.target.value)}
                    />
                  </label>

                  <label>
                    Status
                    <select
                      value={rStatus}
                      onChange={(e) => setRStatus(e.target.value)}
                    >
                      <option value="">All</option>
                      <option value="Paid">Paid</option>
                      <option value="Unpaid">Unpaid</option>
                    </select>
                  </label>

                  {rentFiltered && (
                    <button
                      type="button"
                      className="secondary clear-filters"
                      onClick={() => {
                        setRCompany("");
                        setRAccount("");
                        setRFrom("");
                        setRTo("");
                        setRStatus("");
                        setSearch("");
                      }}
                    >
                      <X size={14} />
                      Clear filters
                    </button>
                  )}
                </div>

                {exportButtons}
              </div>

              {rentsList.loading && !rentsList.loaded ? (
                <p className="muted pad">Loading records...</p>
              ) : (
                <div className="table-wrap">
                  <table className="summary-table">
                    <thead>
                      <tr>
                        <SortTh
                          label="Purchase date"
                          k="entry_date"
                          kind="date"
                          sort={rSort}
                          onSort={sortR}
                        />
                        <SortTh
                          label="Purchase company"
                          k="company"
                          kind="text"
                          sort={rSort}
                          onSort={sortR}
                        />
                        <SortTh
                          label="Vehicle"
                          k="vehicle_number"
                          kind="text"
                          sort={rSort}
                          onSort={sortR}
                        />
                        <SortTh
                          label="Paid date"
                          k="paid_date"
                          kind="date"
                          sort={rSort}
                          onSort={sortR}
                        />
                        <SortTh
                          label="Rent amount"
                          k="amount"
                          kind="num"
                          right
                          sort={rSort}
                          onSort={sortR}
                        />
                        <SortTh
                          label="Account name"
                          k="account_name"
                          kind="text"
                          sort={rSort}
                          onSort={sortR}
                        />
                        <SortTh
                          label="Status"
                          k="status"
                          kind="text"
                          sort={rSort}
                          onSort={sortR}
                        />
                        <SortTh
                          label="Purchase link"
                          k="link"
                          kind="text"
                          sort={rSort}
                          onSort={sortR}
                        />
                        <th>Actions</th>
                      </tr>
                    </thead>

                    <tbody>
                      {rentView.rows.map((r) => (
                        <tr key={r.id}>
                          <td>{dayOf(r.entry_date) || "—"}</td>
                          <td>{companyMap[r.company_id] || "—"}</td>
                          <td>
                            <b>{r.vehicle_number || "—"}</b>
                          </td>
                          <td>{r.paid_date ? dayOf(r.paid_date) : "—"}</td>
                          <td className="num">
                            {r.amount == null || r.amount === ""
                              ? "—"
                              : money(r.amount)}
                          </td>
                          <td>{r.account_name || "—"}</td>
                          <td>
                            <span
                              className={`status-pill ${isRentPaid(r) ? "sold" : "pending"}`}
                            >
                              {isRentPaid(r) ? "Paid" : "Unpaid"}
                            </span>
                          </td>
                          <td>
                            <span
                              className={`status-pill ${r.isLinked ? "sold" : "orphan"}`}
                            >
                              {r.isLinked ? "Linked" : "No purchase found"}
                            </span>
                          </td>
                          <td>
                            <div className="row-actions">
                              <button
                                onClick={() => {
                                  setEditing(r);
                                  setError("");
                                  setModal(true);
                                }}
                                title="Edit"
                              >
                                <Edit3 size={16} />
                              </button>

                              <button
                                onClick={() => remove(r.id)}
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

                  {!rentView.rows.length && (
                    <p className="muted pad">
                      {rentsList.items.length && rentFiltered
                        ? "No records match these filters."
                        : "No rent records yet. Use Add Vehicle rent to create one."}
                    </p>
                  )}
                </div>
              )}

              {!(rentsList.loading && !rentsList.loaded) && (
                <div className="totals-bar one-line">
                  <div className="totals-label">
                    {rentFiltered ? "Filtered totals" : "Totals"}
                    <small>
                      {rentView.rows.length} records ·{" "}
                      {rentView.totals.unpaidCount} unpaid
                    </small>
                  </div>

                  <div className="totals-items">
                    <div>
                      <span>Total rent</span>
                      <b>{money(rentView.totals.amount)}</b>
                    </div>
                    <div>
                      <span>Paid</span>
                      <b>{money(rentView.totals.paid)}</b>
                    </div>
                    <div>
                      <span>Not yet paid</span>
                      <b>{money(rentView.totals.unpaid)}</b>
                    </div>
                    <div>
                      <span>Not linked to a purchase</span>
                      <b>{rentView.totals.unlinked}</b>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ) : page === DUES ? (
            /* PAYMENT DUES — company + remaining balance only */

            <div className="dues-page">
              <div className="dues-head">
                <h3>Payment dues</h3>
                {exportButtons}
              </div>

              {summaryFirstLoad ? (
                <p className="muted pad">Loading records...</p>
              ) : (
                <div className="dues-grid">
                  <div className="panel dues-panel">
                    <div className="table-toolbar">
                      <div>
                        <h3>Payments due</h3>
                        <p className="muted">
                          Companies that owe you · (sales − received) −
                          (purchases − paid) · {duesView.toReceive.length}{" "}
                          {duesView.toReceive.length === 1
                            ? "company"
                            : "companies"}
                        </p>
                      </div>
                    </div>

                    <div className="table-wrap">
                      <table className="summary-table">
                        <thead>
                          <tr>
                            <SortTh
                              label="Company"
                              k="name"
                              sort={dueSort}
                              onSort={sortDue}
                            />
                            <SortTh
                              label="Remaining balance"
                              k="amount"
                              kind="num"
                              right
                              sort={dueSort}
                              onSort={sortDue}
                            />
                          </tr>
                        </thead>
                        <tbody>
                          {duesView.toReceive.map((c) => (
                            <tr key={c.name}>
                              <td>{c.name}</td>
                              <td className="num due-in">{money(c.amount)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>

                      {!duesView.toReceive.length && (
                        <p className="muted pad">Nothing pending.</p>
                      )}
                    </div>

                    <div className="totals-bar one-line">
                      <div className="totals-label">Total</div>
                      <div className="totals-items">
                        <div>
                          <span>Total to receive</span>
                          <b>{money(duesView.totalReceive)}</b>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="panel dues-panel">
                    <div className="table-toolbar">
                      <div>
                        <h3>Payments to pay</h3>
                        <p className="muted">
                          Companies you owe · (purchases − paid) − (sales −
                          received) · {duesView.toPay.length}{" "}
                          {duesView.toPay.length === 1
                            ? "company"
                            : "companies"}
                        </p>
                      </div>
                    </div>

                    <div className="table-wrap">
                      <table className="summary-table">
                        <thead>
                          <tr>
                            <SortTh
                              label="Company"
                              k="name"
                              sort={paySort}
                              onSort={sortPay}
                            />
                            <SortTh
                              label="Remaining balance"
                              k="amount"
                              kind="num"
                              right
                              sort={paySort}
                              onSort={sortPay}
                            />
                          </tr>
                        </thead>
                        <tbody>
                          {duesView.toPay.map((c) => (
                            <tr key={c.name}>
                              <td>{c.name}</td>
                              <td className="num due-out">{money(c.amount)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>

                      {!duesView.toPay.length && (
                        <p className="muted pad">Nothing pending.</p>
                      )}
                    </div>

                    <div className="totals-bar one-line">
                      <div className="totals-label">Total</div>
                      <div className="totals-items">
                        <div>
                          <span>Total to pay</span>
                          <b>{money(duesView.totalPay)}</b>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ) : page === UNLOAD ? (
            /* UNLOAD STATUS — separate from the Sales form */

            <div className="panel fill">
              <div className="table-toolbar">
                <div>
                  <h3>Unload status</h3>

                  <p className="muted">
                    {unloadView.rows.length} of {unloadView.all} sales
                    {summaryLoading && !summaryFirstLoad && " · refreshing…"}
                  </p>
                </div>

                <div className="filter-bar">
                  <label>
                    Customer
                    <select
                      value={uCompany}
                      onChange={(e) => setUCompany(e.target.value)}
                    >
                      <option value="">All customers</option>
                      {customers.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label>
                    Status
                    <select
                      value={uStatus}
                      onChange={(e) => setUStatus(e.target.value)}
                    >
                      <option value="">All</option>
                      <option value="Pending">Pending (not unloaded)</option>
                      <option value="Short">Short (less than sold)</option>
                      <option value="Unloaded">Unloaded</option>
                    </select>
                  </label>

                  <label>
                    From
                    <input
                      type="date"
                      value={uFrom}
                      max={uTo || undefined}
                      onChange={(e) => setUFrom(e.target.value)}
                    />
                  </label>

                  <label>
                    To
                    <input
                      type="date"
                      value={uTo}
                      min={uFrom || undefined}
                      onChange={(e) => setUTo(e.target.value)}
                    />
                  </label>

                  {unloadFiltered && (
                    <button
                      type="button"
                      className="secondary clear-filters"
                      onClick={() => {
                        setUCompany("");
                        setUStatus("");
                        setUFrom("");
                        setUTo("");
                        setSearch("");
                      }}
                    >
                      <X size={14} />
                      Clear filters
                    </button>
                  )}
                </div>

                {exportButtons}
              </div>

              {summaryFirstLoad ? (
                <p className="muted pad">Loading records...</p>
              ) : (
                <div className="table-wrap">
                  <table className="summary-table">
                    <thead>
                      <tr>
                        <SortTh
                          label="Sale date"
                          k="entry_date"
                          kind="date"
                          sort={uSort}
                          onSort={sortU}
                        />
                        <SortTh
                          label="Customer"
                          k="company"
                          sort={uSort}
                          onSort={sortU}
                        />
                        <SortTh
                          label="Vehicle"
                          k="vehicle_number"
                          sort={uSort}
                          onSort={sortU}
                        />
                        <SortTh
                          label="Voucher no."
                          k="voucher_no"
                          sort={uSort}
                          onSort={sortU}
                        />
                        <SortTh
                          label="Sale qty (qtl)"
                          k="quantity"
                          kind="num"
                          right
                          sort={uSort}
                          onSort={sortU}
                        />
                        <SortTh
                          label="Unload date"
                          k="unload_date"
                          kind="date"
                          sort={uSort}
                          onSort={sortU}
                        />
                        <SortTh
                          label="Unload qty (qtl)"
                          k="unload_quantity"
                          kind="num"
                          right
                          sort={uSort}
                          onSort={sortU}
                        />
                        <SortTh
                          label="Shortage (qtl)"
                          k="shortage"
                          kind="num"
                          right
                          sort={uSort}
                          onSort={sortU}
                          title="Sale quantity - unload quantity"
                        />
                        <SortTh
                          label="Waiting"
                          k="waiting"
                          kind="num"
                          right
                          sort={uSort}
                          onSort={sortU}
                          title="Days since the sale while the vehicle is not unloaded"
                        />
                        <SortTh
                          label="Status"
                          k="status"
                          sort={uSort}
                          onSort={sortU}
                        />
                        {!isViewer && <th>Actions</th>}
                      </tr>
                    </thead>

                    <tbody>
                      {unloadView.rows.map((r) => (
                        <tr key={r.id}>
                          <td>{dayOf(r.entry_date) || "—"}</td>
                          <td>{companyMap[r.company_id] || "—"}</td>
                          <td>
                            <b>{r.vehicle_number || "—"}</b>
                          </td>
                          <td>{r.voucher_no || "—"}</td>
                          <td className="num">{qty(r.quantity)}</td>
                          <td>{r.unload_date ? dayOf(r.unload_date) : "—"}</td>
                          <td className="num">
                            {r.status === "Pending"
                              ? "—"
                              : qty(r.unload_quantity)}
                          </td>
                          <td
                            className={`num ${r.shortage > 0 ? "due-out" : ""}`}
                          >
                            {r.shortage == null ? "—" : qty(r.shortage)}
                          </td>
                          <td className="num">
                            {r.waiting == null
                              ? "—"
                              : `${r.waiting} ${r.waiting === 1 ? "day" : "days"}`}
                          </td>
                          <td>
                            <span
                              className={`status-pill ${
                                r.status === "Unloaded"
                                  ? "sold"
                                  : r.status === "Pending"
                                    ? "pending"
                                    : "orphan"
                              }`}
                            >
                              {r.status}
                            </span>
                          </td>
                          {!isViewer && (
                            <td>
                              <div className="row-actions">
                                <button
                                  onClick={() => {
                                    setError("");
                                    setUnloadEdit(r);
                                  }}
                                  title="Update unload"
                                >
                                  <Edit3 size={16} />
                                </button>
                              </div>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  {!unloadView.rows.length && (
                    <p className="muted pad">
                      {unloadView.all && unloadFiltered
                        ? "No records match these filters."
                        : "No sales yet."}
                    </p>
                  )}
                </div>
              )}

              {!summaryFirstLoad && (
                <div className="totals-bar one-line">
                  <div className="totals-label">
                    {unloadFiltered ? "Filtered totals" : "Totals"}
                  </div>

                  <div className="totals-items">
                    <div>
                      <span>Sale qty (qtl)</span>
                      <b>{qty(unloadView.totals.saleQty)}</b>
                    </div>
                    <div>
                      <span>Unloaded qty (qtl)</span>
                      <b>{qty(unloadView.totals.unloadQty)}</b>
                    </div>
                    <div>
                      <span>Shortage (qtl)</span>
                      <b>{qty(unloadView.totals.shortage)}</b>
                    </div>
                    <div>
                      <span>Pending vehicles</span>
                      <b>{unloadView.totals.pending}</b>
                    </div>
                    <div>
                      <span>Pending qty (qtl)</span>
                      <b>{qty(unloadView.totals.pendingQty)}</b>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ) : page === LEDGER ? (
            /* LEDGER — purchases, sales and payments together */

            <div className="panel fill">
              <div className="table-toolbar">
                <div>
                  <h3>Ledger</h3>

                  <p className="muted">
                    {ledgerView.rows.length} of {ledgerView.all} entries
                    {summaryLoading && !summaryFirstLoad && " · refreshing…"}
                  </p>
                </div>

                <div className="filter-bar">
                  <label>
                    Company
                    <select
                      value={lCompany}
                      onChange={(e) => setLCompany(e.target.value)}
                    >
                      <option value="">All companies</option>
                      {companyOptions.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label>
                    Type
                    <select
                      value={lType}
                      onChange={(e) => setLType(e.target.value)}
                    >
                      <option value="">All types</option>
                      <option value="Purchase">Purchase</option>
                      <option value="Sale">Sale</option>
                      <option value="Paid">Payment paid</option>
                      <option value="Received">Payment received</option>
                    </select>
                  </label>

                  <label>
                    From
                    <input
                      type="date"
                      value={lFrom}
                      max={lTo || undefined}
                      onChange={(e) => setLFrom(e.target.value)}
                    />
                  </label>

                  <label>
                    To
                    <input
                      type="date"
                      value={lTo}
                      min={lFrom || undefined}
                      onChange={(e) => setLTo(e.target.value)}
                    />
                  </label>

                  {ledgerFiltered && (
                    <button
                      type="button"
                      className="secondary clear-filters"
                      onClick={() => {
                        setLCompany("");
                        setLType("");
                        setLFrom("");
                        setLTo("");
                        setSearch("");
                      }}
                    >
                      <X size={14} />
                      Clear filters
                    </button>
                  )}
                </div>

                {exportButtons}
              </div>

              {summaryFirstLoad ? (
                <p className="muted pad">Loading records...</p>
              ) : (
                <div className="table-wrap">
                  <table className="summary-table">
                    <thead>
                      <tr>
                        <SortTh
                          label="Date"
                          k="date"
                          kind="date"
                          sort={lSort}
                          onSort={sortL}
                        />
                        <SortTh
                          label="Type"
                          k="kind"
                          sort={lSort}
                          onSort={sortL}
                        />
                        <SortTh
                          label="Company"
                          k="company"
                          sort={lSort}
                          onSort={sortL}
                        />
                        <SortTh
                          label="Vehicle"
                          k="vehicle"
                          sort={lSort}
                          onSort={sortL}
                        />
                        <SortTh
                          label="Voucher / reference"
                          k="ref"
                          sort={lSort}
                          onSort={sortL}
                        />
                        <SortTh
                          label="Qty (qtl)"
                          k="qty"
                          kind="num"
                          right
                          sort={lSort}
                          onSort={sortL}
                        />
                        <SortTh
                          label="Total"
                          k="amount"
                          kind="num"
                          right
                          sort={lSort}
                          onSort={sortL}
                        />
                      </tr>
                    </thead>

                    <tbody>
                      {ledgerView.rows.map((r) => (
                        <tr key={r.id}>
                          <td>{dayOf(r.date) || "—"}</td>
                          <td>
                            <span
                              className={`type-pill t-${r.kind.toLowerCase()}`}
                            >
                              {r.kind === "Paid"
                                ? "Payment paid"
                                : r.kind === "Received"
                                  ? "Payment received"
                                  : r.kind}
                            </span>
                          </td>
                          <td>{r.company || "—"}</td>
                          <td>{r.vehicle || "—"}</td>
                          <td>{r.ref || "—"}</td>
                          <td className="num">
                            {r.qty == null ? "—" : qty(r.qty)}
                          </td>
                          <td className="num">{money(r.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  {!ledgerView.rows.length && (
                    <p className="muted pad">
                      {ledgerView.all && ledgerFiltered
                        ? "No entries match these filters."
                        : "No entries yet."}
                    </p>
                  )}
                </div>
              )}

              {!summaryFirstLoad && (
                <div className="totals-bar one-line">
                  <div className="totals-label">
                    {ledgerFiltered ? "Filtered totals" : "Totals"}
                  </div>

                  <div className="totals-items">
                    <div title="Purchase qty (qtl)">
                      <span>Purchase qty</span>
                      <b>{qty(ledgerView.totals.pQty)}</b>
                    </div>
                    <div title="Sale qty (qtl)">
                      <span>Sale qty</span>
                      <b>{qty(ledgerView.totals.sQty)}</b>
                    </div>
                    <div title="Total purchases">
                      <span>Purchases</span>
                      <b>{money(ledgerView.totals.purchases)}</b>
                    </div>
                    <div title="Total sales">
                      <span>Sales</span>
                      <b>{money(ledgerView.totals.sales)}</b>
                    </div>
                    <div title="Total paid">
                      <span>Paid</span>
                      <b>{money(ledgerView.totals.paid)}</b>
                    </div>
                    <div title="Total received">
                      <span>Received</span>
                      <b>{money(ledgerView.totals.received)}</b>
                    </div>
                    <div title="To pay = purchases - paid">
                      <span>To pay</span>
                      <b>{money(ledgerView.totals.payable)}</b>
                    </div>
                    <div title="To receive = sales - received">
                      <span>To receive</span>
                      <b>{money(ledgerView.totals.receivable)}</b>
                    </div>
                    <div title="Remaining balance = to receive - to pay">
                      <span>Balance</span>
                      <b>{money(ledgerView.totals.balance)}</b>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ) : page === SUMMARY ? (
            /* COMPANY SUMMARY */

            <div className="panel fill">
              <div className="table-toolbar">
                <div>
                  <h3>Company summary</h3>

                  <p className="muted">
                    {summary.rows.length} companies · purchases, sales, payments
                    and dues
                    {summaryLoading && !summaryFirstLoad && " · refreshing…"}
                  </p>
                </div>

                <div className="filter-bar">
                  <label>
                    Company
                    <select
                      value={sCompany}
                      onChange={(e) => setSCompany(e.target.value)}
                    >
                      <option value="">All companies</option>
                      {companyOptions.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
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

                {exportButtons}
              </div>

              {summaryFirstLoad ? (
                <p className="muted pad">Loading records...</p>
              ) : (
                <div className="table-wrap">
                  <table className="summary-table">
                    <thead>
                      <tr>
                        <SortTh
                          label="Company"
                          k="name"
                          kind="text"
                          sort={sSort}
                          onSort={sortS}
                        />
                        <SortTh
                          label="Purchase qty (qtl)"
                          k="pQty"
                          kind="num"
                          right
                          sort={sSort}
                          onSort={sortS}
                        />
                        <SortTh
                          label="Purchase total"
                          k="pTotal"
                          kind="num"
                          right
                          sort={sSort}
                          onSort={sortS}
                        />
                        <SortTh
                          label="Paid"
                          k="paid"
                          kind="num"
                          right
                          sort={sSort}
                          onSort={sortS}
                        />
                        <SortTh
                          label="Payable due"
                          k="payable"
                          kind="num"
                          right
                          sort={sSort}
                          onSort={sortS}
                        />
                        <SortTh
                          label="Sales qty (qtl)"
                          k="sQty"
                          kind="num"
                          right
                          sort={sSort}
                          onSort={sortS}
                        />
                        <SortTh
                          label="Sales total"
                          k="sTotal"
                          kind="num"
                          right
                          sort={sSort}
                          onSort={sortS}
                        />
                        <SortTh
                          label="Received"
                          k="received"
                          kind="num"
                          right
                          sort={sSort}
                          onSort={sortS}
                        />
                        <SortTh
                          label="Receivable due"
                          k="receivable"
                          kind="num"
                          right
                          sort={sSort}
                          onSort={sortS}
                        />
                        <SortTh
                          label="Net balance"
                          k="net"
                          kind="num"
                          right
                          sort={sSort}
                          onSort={sortS}
                        />
                      </tr>
                    </thead>

                    <tbody>
                      {summary.rows.map((c) => (
                        <tr key={c.id}>
                          <td>
                            <b>{c.name}</b>
                          </td>
                          <td className="num">{qty(c.pQty)}</td>
                          <td className="num">{money(c.pTotal)}</td>
                          <td className="num">{money(c.paid)}</td>
                          <td
                            className={`num ${c.payable > 0 ? "due-out" : ""}`}
                          >
                            {money(c.payable)}
                          </td>
                          <td className="num">{qty(c.sQty)}</td>
                          <td className="num">{money(c.sTotal)}</td>
                          <td className="num">{money(c.received)}</td>
                          <td
                            className={`num ${c.receivable > 0 ? "due-in" : ""}`}
                          >
                            {money(c.receivable)}
                          </td>
                          <td
                            className={`num ${c.net > 0 ? "due-in" : c.net < 0 ? "due-out" : ""}`}
                          >
                            {money(c.net)}
                          </td>
                        </tr>
                      ))}
                    </tbody>

                    {summary.rows.length > 0 && (
                      <tfoot>
                        <tr>
                          <td>Total</td>
                          <td className="num">{qty(summary.totals.pQty)}</td>
                          <td className="num">
                            {money(summary.totals.pTotal)}
                          </td>
                          <td className="num">{money(summary.totals.paid)}</td>
                          <td className="num">
                            {money(summary.totals.payable)}
                          </td>
                          <td className="num">{qty(summary.totals.sQty)}</td>
                          <td className="num">
                            {money(summary.totals.sTotal)}
                          </td>
                          <td className="num">
                            {money(summary.totals.received)}
                          </td>
                          <td className="num">
                            {money(summary.totals.receivable)}
                          </td>
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
                <div className="totals-bar one-line">
                  <div className="totals-label">
                    {sCompany || sFrom || sTo || search
                      ? "Filtered totals"
                      : "Totals"}
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
          ) : (
            /* DATA TABLE */

            <div className="panel fill">
              <div className="table-toolbar">
                <div>
                  <h3>{PAGE_LABEL[page] || page} register</h3>

                  <p className="muted">
                    {filtered.length} of {rows.length} records
                    {dataSort.key &&
                      ` · sorted by ${(titleMap[dataSort.key] || dataSort.key.replaceAll("_", " ")).toLowerCase()} (${dataSort.dir === "asc" ? "low to high" : "high to low"})`}
                    {refreshing && " · refreshing…"}
                  </p>
                </div>

                {hasFilters && (
                  <div className="filter-bar">
                    <label>
                      Company
                      <select
                        value={filters.company}
                        onChange={(e) =>
                          dispatch(
                            setFilter({
                              page,
                              key: "company",
                              value: e.target.value,
                            }),
                          )
                        }
                      >
                        <option value="">All companies</option>
                        {(page === "Purchases" || page === "Orders"
                          ? suppliers
                          : page === "Sales"
                            ? customers
                            : companyOptions
                        ).map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
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
                          dispatch(
                            setFilter({
                              page,
                              key: "from",
                              value: e.target.value,
                            }),
                          )
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
                          dispatch(
                            setFilter({
                              page,
                              key: "to",
                              value: e.target.value,
                            }),
                          )
                        }
                      />
                    </label>

                    {page === "Payments" && (
                      <label>
                        Direction
                        <select
                          value={filters.direction}
                          onChange={(e) =>
                            dispatch(
                              setFilter({
                                page,
                                key: "direction",
                                value: e.target.value,
                              }),
                            )
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

                {hasFilters && exportButtons}
              </div>

              {firstLoad ? (
                <p className="muted pad">Loading records...</p>
              ) : (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        {columns[page].map((key) => (
                          <SortTh
                            key={key}
                            label={titleMap[key] || key.replaceAll("_", " ")}
                            k={key}
                            kind={
                              NUMERIC_KEYS.includes(key)
                                ? "num"
                                : DATE_KEYS.includes(key)
                                  ? "date"
                                  : "text"
                            }
                            sort={dataSort}
                            onSort={sortData}
                          />
                        ))}

                        {!isViewer && <th>Actions</th>}
                      </tr>
                    </thead>

                    <tbody>
                      {filtered.map((record) => (
                        <tr key={record.id}>
                          {columns[page].map((key) => (
                            <td key={key}>
                              {display(key, record[key], record)}
                            </td>
                          ))}

                          {!isViewer && (
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
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  {!filtered.length && (
                    <p className="muted pad">
                      {rows.length && activeFilterCount
                        ? "No records match these filters."
                        : "No records found."}
                    </p>
                  )}
                </div>
              )}

              {hasFilters && !firstLoad && (
                <div className="totals-bar one-line">
                  <div className="totals-label">
                    {activeFilterCount > 0 || search
                      ? "Filtered totals"
                      : "Totals"}
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
                          <span>
                            {page === "Sales"
                              ? "Total sales"
                              : page === "Orders"
                                ? "Total order value"
                                : "Total purchases"}
                          </span>
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

      {notice && (
        <div
          className={`toast ${notice.tone}`}
          role="status"
          aria-live="polite"
        >
          <div className="toast-head">
            <b>{notice.title}</b>
            <button
              type="button"
              className="icon-btn"
              onClick={() => setNotice(null)}
              aria-label="Close"
            >
              <X size={16} />
            </button>
          </div>
          {notice.lines.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </div>
      )}

      {dueExport && (
        <div className="modal-backdrop" onClick={() => setDueExport(null)}>
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label="Choose the list to export"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modal-head">
              <div>
                <p className="eyebrow">
                  EXPORT {dueExport === "pdf" ? "PDF" : "EXCEL"}
                </p>
                <h2>Which list do you need?</h2>
              </div>

              <button
                type="button"
                className="icon-btn"
                onClick={() => setDueExport(null)}
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>

            <div className="modal-actions">
              <button
                type="button"
                className="secondary"
                onClick={() => setDueExport(null)}
              >
                Cancel
              </button>

              <button
                type="button"
                className="primary"
                onClick={() => {
                  const type = dueExport;
                  setDueExport(null);
                  runExport(type, "due");
                }}
              >
                Payments due
              </button>

              <button
                type="button"
                className="primary"
                onClick={() => {
                  const type = dueExport;
                  setDueExport(null);
                  runExport(type, "pay");
                }}
              >
                Payments to pay
              </button>
            </div>
          </div>
        </div>
      )}

      {unloadEdit && !isViewer && (
        <div className="modal-backdrop" onClick={() => setUnloadEdit(null)}>
          <form
            key={unloadEdit.id}
            className="modal"
            onSubmit={saveUnload}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modal-head">
              <div>
                <p className="eyebrow">UNLOAD STATUS</p>
                <h2>Update unload</h2>
                <p className="muted">
                  {unloadEdit.vehicle_number || "—"} ·{" "}
                  {companyMap[unloadEdit.company_id] || "—"} · sold{" "}
                  {qty(unloadEdit.quantity)} qtl
                </p>
              </div>

              <button
                type="button"
                className="icon-btn"
                onClick={() => setUnloadEdit(null)}
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>

            <div className="form-grid">
              <label>
                Unload date
                <input
                  name="unload_date"
                  type="date"
                  defaultValue={dayOf(unloadEdit.unload_date) || today()}
                />
              </label>

              <label>
                Unload quantity (qtl) - leave 0 if not unloaded yet
                <input
                  name="unload_quantity"
                  type="number"
                  step="any"
                  min="0"
                  defaultValue={Number(unloadEdit.unload_quantity || 0)}
                />
              </label>
            </div>

            <div className="modal-actions">
              <button
                type="button"
                className="secondary"
                onClick={() => setUnloadEdit(null)}
              >
                Cancel
              </button>

              <button className="primary" disabled={busy}>
                {busy ? "Saving..." : "Save unload"}
              </button>
            </div>
          </form>
        </div>
      )}

      {modal && !isViewer && (
        <div className="modal-backdrop" onClick={() => setModal(false)}>
          <form
            className="modal"
            onSubmit={save}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modal-head">
              <div>
                <p className="eyebrow">RECORD MANAGEMENT</p>

                <h2>
                  {editing ? "Edit" : "Add"} {RECORD_LABEL[dataPage]}
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
              {fields[dataPage].map(([key, label, type, required]) => (
                <label
                  key={key}
                  className={type === "text" && key === "notes" ? "wide" : ""}
                >
                  {label}

                  {type === "company" ? (
                    <select
                      name={key}
                      defaultValue={editing?.[key] || ""}
                      required={required}
                    >
                      <option value="">Select company</option>

                      {companyOptions.map((company) => (
                        <option value={company.id} key={company.id}>
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
                          : key === "status"
                            ? "Open"
                            : "received")
                      }
                      required={required}
                    >
                      {(key === "company_type"
                        ? ["Customer", "Supplier", "Both"]
                        : key === "status"
                          ? ["Open", "Delivered", "Cancelled"]
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
                        (type === "date" &&
                        key !== "paid_date" &&
                        key !== "unload_date"
                          ? today()
                          : "")
                      }
                      required={required}
                      list={
                        key === "account_name" ? "account-names" : undefined
                      }
                    />
                  )}
                </label>
              ))}
            </div>

            {dataPage === "Rents" && (
              <datalist id="account-names">
                {rentView.accounts.map((a) => (
                  <option key={a} value={a} />
                ))}
              </datalist>
            )}

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

              <button className="primary" disabled={busy}>
                {busy ? "Saving..." : "Save record"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
