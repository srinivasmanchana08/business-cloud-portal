
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@supabase/supabase-js";

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

const today = () => {
  const date = new Date();
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
};

const getErrorMessage = (error) =>
  error?.message || "Something went wrong. Please try again.";

// =====================================================
// 5. MAIN APP
// =====================================================

export default function App() {
  const [session, setSession] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);

  const [page, setPage] = useState("Dashboard");

  const [rows, setRows] = useState([]);
  const [stats, setStats] = useState(null);
  const [companies, setCompanies] = useState([]);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");

  const [modal, setModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [mobile, setMobile] = useState(false);

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
  // 9. LOAD DASHBOARD AND DATABASE RECORDS
  // ===================================================

  const load = useCallback(async () => {
    if (!session) return;

    setBusy(true);
    setError("");

    try {
      const [dashboardData, companyData] = await Promise.all([
        api("dashboard"),
        api("companies"),
      ]);

      setStats(dashboardData);
      setCompanies(companyData);

      if (page !== "Dashboard") {
        const data = await api(page.toLowerCase());
        setRows(data);
      } else {
        setRows([]);
      }
    } catch (err) {
      console.error("Data loading error:", err);
      setError(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }, [session, page, api]);

  useEffect(() => {
    if (session) {
      load();
    } else {
      setStats(null);
      setCompanies([]);
      setRows([]);
    }
  }, [session, page, load]);

  // ===================================================
  // 10. SEARCH FILTER
  // ===================================================

  const filtered = useMemo(
    () =>
      rows.filter((record) =>
        JSON.stringify(record)
          .toLowerCase()
          .includes(search.toLowerCase())
      ),
    [rows, search]
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
      ["quantity", "Quantity", "number"],
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
      ["quantity", "Quantity", "number"],
      ["rate", "Rate", "number"],
      ["gross_total", "Gross total (₹)", "number"],
      ["unload_date", "Unload date", "date"],
      ["unload_quantity", "Unload quantity", "number"],
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
      return companies.find((company) => company.id === value)?.name || "—";
    }

    if (
      ["gross_total", "purchase_total", "amount"].includes(key)
    ) {
      return money(value);
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

      const endpoint = `${page.toLowerCase()}${
        editing ? `/${editing.id}` : ""
      }`;

      await api(endpoint, {
        method: editing ? "PUT" : "POST",
        body: JSON.stringify(body),
      });

      setModal(false);
      setEditing(null);

      await load();
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
      await api(`${page.toLowerCase()}/${id}`, {
        method: "DELETE",
      });

      await load();
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

            <span className="live-dot">● Connected</span>

            <button
              className="icon-btn"
              onClick={load}
              title="Refresh"
              disabled={busy}
            >
              <RefreshCw size={17} />
            </button>

          </div>
        </header>

        {/* PAGE CONTENT */}

        <section className="content">

          <div className="page-heading">

            <div>
              <p className="eyebrow">BUSINESS OVERVIEW</p>

              <h1>{page}</h1>

              <p className="muted">
                {page === "Dashboard"
                  ? "Monitor sales, purchases and cash flow in one place."
                  : `Manage and update your ${page.toLowerCase()} records.`}
              </p>
            </div>

            {page !== "Dashboard" && (
              <button
                className="primary"
                onClick={() => {
                  setEditing(null);
                  setError("");
                  setModal(true);
                }}
              >
                <Plus size={17} />
                Add {page.slice(0, -1)}
              </button>
            )}

          </div>

          {/* ERROR MESSAGE */}

          {error && (
            <div className="error">
              {error}
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

          ) : (

            /* DATA TABLE */

            <div className="panel">

              <div className="table-toolbar">

                <div>
                  <h3>{page} register</h3>

                  <p className="muted">
                    {filtered.length} records shown · latest 500
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

              {busy ? (

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
                            {titleMap[key] || key.replaceAll("_", " ")}
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
                      No records found.
                    </p>
                  )}

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
                  {editing ? "Edit" : "Add"} {page.slice(0, -1)}
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

              {fields[page].map(
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
