import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import { promisify } from "node:util";
import { gzip } from "node:zlib";
import { createClient } from "@supabase/supabase-js";

const gzipAsync = promisify(gzip);

const app = express();

// ==========================================
// 1. ENVIRONMENT CONFIGURATION
// ==========================================

const requiredEnv = ["SUPABASE_URL", "SUPABASE_ANON_KEY"];

const missingEnv = requiredEnv.filter((key) => !process.env[key]);

if (missingEnv.length) {
  console.error(
    `FATAL: Missing environment variable(s): ${missingEnv.join(", ")}.\n` +
      "Set them in Render > your service > Environment, then redeploy.",
  );
  process.exit(1);
}

const allowedOrigins = (process.env.CLIENT_ORIGIN || "http://localhost:5173")
  .split(",")
  .map((origin) => origin.trim().replace(/\/+$/, ""))
  .filter(Boolean);

// ==========================================
// 2. MIDDLEWARE
// ==========================================

app.use(helmet());

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin.replace(/\/+$/, ""))) {
        return callback(null, true);
      }

      console.warn(`CORS blocked origin: ${origin}`);
      return callback(null, false);
    },
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    maxAge: 86400, // browser may cache the preflight answer
  }),
);

app.use(express.json({ limit: "1mb" }));

// ==========================================
// 3. PUBLIC HEALTH ROUTES
// ==========================================

app.get("/", (_req, res) => {
  res.status(200).json({
    success: true,
    message: "Manchana Srinivas Backend is Running!",
    status: "OK",
  });
});

app.get("/health", (_req, res) => {
  res.status(200).json({
    success: true,
    message: "Server is healthy",
  });
});

// ==========================================
// 4. AUTHENTICATION MIDDLEWARE
// ==========================================

// A token is verified with Supabase once and then remembered for a short time,
// so a burst of requests (or a page full of lists) costs one verification, not
// one per request. The cache never outlives the token itself.
const SESSION_TTL_MS = 60 * 1000;
const SESSION_MAX = 200;
const sessions = new Map(); // token -> { promise, expires }

function tokenExpiry(token) {
  try {
    const { exp } = JSON.parse(
      Buffer.from(token.split(".")[1], "base64url").toString(),
    );
    return exp ? exp * 1000 : 0;
  } catch {
    return 0;
  }
}

function authenticate(token) {
  const now = Date.now();
  const hit = sessions.get(token);
  if (hit && hit.expires > now) return hit.promise;

  // The user's own client: RLS in the database enforces what they may see.
  const client = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY,
    {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
      },
    },
  );

  const promise = client.auth
    .getUser(token)
    .then(({ data, error }) =>
      error || !data?.user ? null : { user: data.user, client },
    );

  const exp = tokenExpiry(token);
  sessions.set(token, {
    promise,
    expires: Math.min(now + SESSION_TTL_MS, exp || Infinity),
  });
  if (sessions.size > SESSION_MAX)
    sessions.delete(sessions.keys().next().value);

  // never keep a failed check
  promise.then(
    (result) => !result && sessions.delete(token),
    () => sessions.delete(token),
  );

  return promise;
}

setInterval(() => {
  const now = Date.now();
  for (const [token, { expires }] of sessions) {
    if (expires <= now) sessions.delete(token);
  }
}, SESSION_TTL_MS).unref();

async function requireAuth(req, res, next) {
  try {
    const token = req.headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1];

    if (!token) {
      return res.status(401).json({ error: "Sign in required" });
    }

    const session = await authenticate(token);

    if (!session) {
      return res.status(401).json({ error: "Invalid or expired session" });
    }

    req.user = session.user;
    req.supabase = session.client;
    next();
  } catch (error) {
    console.error("Authentication error:", error.message);
    return res.status(500).json({ error: "Authentication service error" });
  }
}

// Protect all API routes.
app.use("/api", requireAuth);

// People who registered themselves on the login screen get no data until the
// owner gives them a role (Users page).
app.use("/api", (req, res, next) => {
  const meta = req.user?.app_metadata || {};
  if (!meta.role && req.user?.user_metadata?.self_signup === true) {
    return res
      .status(403)
      .json({ error: "Your account is waiting for the owner's approval." });
  }
  next();
});

// View-only accounts: reading is allowed, any change is refused.
app.use("/api", (req, res, next) => {
  if (isViewer(req) && !["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    return res.status(403).json({ error: "This account is view only." });
  }
  next();
});

// The owner is a user whose Supabase app_metadata has role = "owner".
// app_metadata can only be changed from the Supabase dashboard / SQL,
// never by the user, so it is safe to trust.
const isOwner = (req) => req.user?.app_metadata?.role === "owner";

// A viewer (app_metadata.role = "viewer") can read but never change anything.
const isViewer = (req) => req.user?.app_metadata?.role === "viewer";

// Update / delete: the owner account may change any row it can see (Supabase RLS
// still decides what is visible). Other accounts only touch their own rows.
const ownRows = (query, req) =>
  isOwner(req) ? query : query.eq("owner_id", req.user.id);

// Businesses shown as folders in the sidebar.
const BUSINESSES = ["DDGS", "Maize and Turmeric"];

// ==========================================
// 5. DATABASE RESOURCE CONFIGURATION
// ==========================================

const resources = {
  companies: {
    table: "companies",
    fields: [
      "name",
      "company_type",
      "credit_days",
      "phone",
      "email",
      "address",
      "notes",
    ],
  },

  purchases: {
    table: "purchases",
    scoped: true,
    fields: [
      "company_id",
      "entry_date",
      "voucher_no",
      "vehicle_number",
      "particulars",
      "quantity",
      "rate",
      "purchase_total",
      "notes",
    ],
  },

  sales: {
    table: "sales",
    scoped: true,
    fields: [
      "company_id",
      "entry_date",
      "voucher_no",
      "vehicle_number",
      "quantity",
      "rate",
      "gross_total",
      "unload_date",
      "unload_quantity",
      "payment_due_date",
      "purchase_reference",
      "notes",
    ],
  },

  payments: {
    table: "payments",
    scoped: true,
    ownerOnly: true,
    viewerCanRead: true, // view-only accounts may read payments (GET only)
    fields: [
      "company_id",
      "payment_date",
      "direction",
      "amount",
      "reference",
      "notes",
    ],
  },

  // Purchase orders placed with suppliers. Exposed as /api/orders
  orders: {
    table: "purchase_orders",
    scoped: true,
    fields: [
      "company_id",
      "order_date",
      "po_number",
      "quantity",
      "rate",
      "order_total",
      "delivery_date",
      "status",
      "notes",
    ],
  },

  // Vehicle rent paid to a transporter for a purchase vehicle.
  // Exposed as /api/rents
  rents: {
    table: "vehicle_rents",
    scoped: true,
    ownerOnly: true,
    fields: [
      "company_id",
      "entry_date",
      "vehicle_number",
      "paid_date",
      "amount",
      "account_name",
      "notes",
    ],
  },
};

// ==========================================
// 5b. SHARED QUERY HELPERS
// ==========================================

const unknownBusiness = (business) =>
  Boolean(business) && !BUSINESSES.includes(business);

// the newest 500 rows of a resource (optionally one business / name search)
function listQuery(db, key, { business, search } = {}) {
  const { table, scoped } = resources[key];

  let query = db
    .from(table)
    .select("*")
    .order("created_at", { ascending: false })
    .limit(500);

  if (scoped && business) query = query.eq("business", business);

  if (key === "companies" && search) {
    query = query.ilike("name", `%${String(search).slice(0, 100)}%`);
  }

  return query;
}

// A sum can span more than the 1000 rows Supabase returns per request,
// so read it page by page.
async function sumColumn(db, table, column, business, direction) {
  const PAGE = 1000;
  let total = 0;

  for (let from = 0; ; from += PAGE) {
    let query = db
      .from(table)
      .select(column)
      .order("id")
      .range(from, from + PAGE - 1);

    if (business) query = query.eq("business", business);
    if (direction) query = query.eq("direction", direction);

    const { data, error } = await query;
    if (error) throw error;

    for (const row of data) total += Number(row[column] || 0);
    if (data.length < PAGE) return total;
  }
}

// Totals computed by the database function dashboard_totals (see
// supabase-speedup.sql). Returns null when the function is not installed yet.
let totalsFunctionMissing = false;

async function totalsFromDatabase(db, business) {
  if (totalsFunctionMissing) return null;

  const { data, error } = await db
    .rpc("dashboard_totals", { p_business: business || null })
    .single();

  if (error) {
    // not installed: use the slower row-by-row sums and stop asking
    if (error.code === "PGRST202" || error.code === "42883") {
      totalsFunctionMissing = true;
      console.warn("dashboard_totals() not found - run supabase-speedup.sql");
      return null;
    }
    throw error;
  }

  return data;
}

// Dashboard totals for one business ("" = all). Owner and view-only accounts
// also get the payment figures.
async function dashboardTotals(req, business) {
  const db = req.supabase;
  const withPayments = isOwner(req) || isViewer(req);

  const fast = await totalsFromDatabase(db, business);

  const [purchases, sales, collected, disbursed] = fast
    ? [fast.purchases, fast.sales, fast.collected, fast.disbursed].map(Number)
    : await Promise.all([
        sumColumn(db, "purchases", "purchase_total", business),
        sumColumn(db, "sales", "gross_total", business),
        withPayments
          ? sumColumn(db, "payments", "amount", business, "received")
          : 0,
        withPayments
          ? sumColumn(db, "payments", "amount", business, "paid")
          : 0,
      ]);

  if (!withPayments) return { sales, purchases };

  return {
    sales,
    purchases,
    collected,
    disbursed,
    receivable: sales - collected,
    payable: purchases - disbursed,
    net: collected - disbursed,
  };
}

// ==========================================
// 6. HELPER: FILTER ALLOWED FIELDS
// ==========================================

function getPayload(fields, body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return null;
  }

  return Object.fromEntries(
    fields
      .filter((field) => body[field] !== undefined)
      .map((field) => [field, body[field]]),
  );
}

// ==========================================
// 7. CRUD API ROUTES
// ==========================================

for (const [key, config] of Object.entries(resources)) {
  const { table, fields } = config;

  // payments and vehicle rents: owner only
  if (config.ownerOnly) {
    app.use(`/api/${key}`, (req, res, next) =>
      isOwner(req) || (config.viewerCanRead && isViewer(req))
        ? next()
        : res.status(403).json({ error: "Only the owner can access this." }),
    );
  }

  // GET RECORDS
  app.get(`/api/${key}`, async (req, res) => {
    try {
      const { business, search } = req.query;

      if (config.scoped && unknownBusiness(business)) {
        return res.status(400).json({ error: "Unknown business" });
      }

      const { data, error } = await listQuery(req.supabase, key, {
        business,
        search,
      });

      if (error) {
        console.error(`GET ${key}:`, error.message);
        return res.status(400).json({ error: error.message });
      }

      return res.json(data);
    } catch (error) {
      console.error(`GET ${key}:`, error.message);
      return res.status(500).json({ error: "Failed to fetch records" });
    }
  });

  // CREATE RECORD
  app.post(`/api/${key}`, async (req, res) => {
    try {
      const payload = getPayload(fields, req.body);

      if (!payload || Object.keys(payload).length === 0) {
        return res.status(400).json({
          error: "Valid record data is required",
        });
      }

      // Never trust owner_id supplied by the frontend.
      payload.owner_id = req.user.id;

      // Records that belong to one business must say which one.
      if (config.scoped) {
        const business = req.body?.business;

        if (!business) {
          return res.status(400).json({
            error: "Business is required for this record type",
          });
        }

        if (!BUSINESSES.includes(business)) {
          return res.status(400).json({ error: "Unknown business" });
        }

        payload.business = business;
      }

      const { data, error } = await req.supabase
        .from(table)
        .insert(payload)
        .select()
        .single();

      if (error) {
        console.error(`POST ${key}:`, error.message);
        return res.status(400).json({ error: error.message });
      }

      return res.status(201).json(data);
    } catch (error) {
      console.error(`POST ${key}:`, error.message);
      return res.status(500).json({ error: "Failed to create record" });
    }
  });

  // UPDATE RECORD
  app.put(`/api/${key}/:id`, async (req, res) => {
    try {
      const payload = getPayload(fields, req.body);

      if (!payload || Object.keys(payload).length === 0) {
        return res.status(400).json({
          error: "Valid update data is required",
        });
      }

      const { data, error } = await ownRows(
        req.supabase.from(table).update(payload).eq("id", req.params.id),
        req,
      )
        .select()
        .maybeSingle();

      if (error) {
        console.error(`PUT ${key}:`, error.message);
        return res.status(400).json({ error: error.message });
      }

      // nothing updated: the record was already deleted (another tab / double
      // click) or belongs to another user
      if (!data) {
        return res.status(404).json({
          error:
            "This record could not be updated. It may have been deleted, or it belongs to another account.",
        });
      }

      return res.json(data);
    } catch (error) {
      console.error(`PUT ${key}:`, error.message);
      return res.status(500).json({ error: "Failed to update record" });
    }
  });

  // DELETE RECORD
  app.delete(`/api/${key}/:id`, async (req, res) => {
    try {
      const { data, error } = await ownRows(
        req.supabase.from(table).delete().eq("id", req.params.id),
        req,
      ).select("id");

      if (error) {
        console.error(`DELETE ${key}:`, error.message);
        return res.status(400).json({ error: error.message });
      }

      // deleting a record that is already gone is not an error
      return res.json({
        success: true,
        id: req.params.id,
        deleted: (data || []).length,
      });
    } catch (error) {
      console.error(`DELETE ${key}:`, error.message);
      return res.status(500).json({ error: "Failed to delete record" });
    }
  });
}

// ==========================================
// 7b. USER ROLES (owner only)
// Lists the people who signed up and lets the owner set their role.
// Needs SUPABASE_SERVICE_ROLE_KEY (Supabase > Project Settings > API >
// service_role). Keep it on the server only - never in the frontend.
// ==========================================

const ROLES = ["", "viewer", "owner"]; // "" = no role

let adminClient = null;
const adminApi = () => {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return null;
  adminClient ||= createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
  return adminClient.auth.admin;
};

// "Chrome on Windows" from a browser user-agent string
const describeDevice = (ua = "") => {
  if (!ua) return "Unknown device";
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /OPR\/|Opera/.test(ua)
      ? "Opera"
      : /Chrome\//.test(ua)
        ? "Chrome"
        : /Firefox\//.test(ua)
          ? "Firefox"
          : /Safari\//.test(ua)
            ? "Safari"
            : "Browser";
  const system = /Android/.test(ua)
    ? "Android"
    : /iPhone|iPad|iOS/.test(ua)
      ? "iPhone/iPad"
      : /Windows/.test(ua)
        ? "Windows"
        : /Mac OS X|Macintosh/.test(ua)
          ? "Mac"
          : /Linux/.test(ua)
            ? "Linux"
            : "";
  return system ? `${browser} on ${system}` : browser;
};

const ownerOnlyRoute = (req, res, next) =>
  isOwner(req)
    ? next()
    : res.status(403).json({ error: "Only the owner can manage users." });

app.get("/api/users", ownerOnlyRoute, async (_req, res) => {
  try {
    const admin = adminApi();
    if (!admin) {
      return res.status(503).json({
        error:
          "User management is not set up. Add SUPABASE_SERVICE_ROLE_KEY to the server environment and redeploy.",
      });
    }

    const users = [];
    for (let page = 1; page <= 20; page++) {
      const { data, error } = await admin.listUsers({ page, perPage: 200 });
      if (error) throw error;
      users.push(...data.users);
      if (data.users.length < 200) break;
    }

    // logged-in devices (sessions). Needs user_sessions.sql run once in Supabase.
    const devicesByUser = {};
    let devicesOk = true;
    const { data: sessions, error: sessionError } = await adminClient.rpc(
      "admin_user_sessions",
    );
    if (sessionError) {
      devicesOk = false;
      console.error("Sessions unavailable:", sessionError.message);
    } else {
      (sessions || []).forEach((s) => {
        (devicesByUser[s.user_id] ||= []).push({
          id: s.session_id,
          device: describeDevice(s.user_agent),
          ip: s.ip || "",
          last_active: s.updated_at || s.created_at,
        });
      });
    }

    res.json(
      users
        .map((u) => ({
          devices: devicesOk
            ? (devicesByUser[u.id] || []).sort((a, b) =>
                String(b.last_active).localeCompare(String(a.last_active)),
              )
            : null,
          id: u.id,
          email: u.email || u.phone || "(no email)",
          role: u.app_metadata?.role || "",
          created_at: u.created_at,
          last_sign_in_at: u.last_sign_in_at || null,
          confirmed: Boolean(u.email_confirmed_at || u.confirmed_at),
        }))
        .sort((a, b) =>
          String(b.created_at).localeCompare(String(a.created_at)),
        ),
    );
  } catch (error) {
    console.error("List users failed:", error.message);
    res.status(500).json({ error: "Could not load users." });
  }
});

app.put("/api/users/:id/role", ownerOnlyRoute, async (req, res) => {
  try {
    const admin = adminApi();
    if (!admin) {
      return res.status(503).json({
        error:
          "User management is not set up. Add SUPABASE_SERVICE_ROLE_KEY to the server environment and redeploy.",
      });
    }

    const role = String(req.body?.role ?? "");
    if (!ROLES.includes(role)) {
      return res
        .status(400)
        .json({ error: "Role must be viewer, owner or empty." });
    }

    // the owner can not remove their own owner access by mistake
    if (req.params.id === req.user.id) {
      return res
        .status(400)
        .json({ error: "You cannot change your own role." });
    }

    const { data, error } = await admin.updateUserById(req.params.id, {
      app_metadata: { role: role || null }, // null removes the role
    });
    if (error) throw error;

    res.json({ id: data.user.id, role: data.user.app_metadata?.role || "" });
  } catch (error) {
    console.error("Change role failed:", error.message);
    res.status(500).json({ error: "Could not change the role." });
  }
});

// ==========================================
// 8. DASHBOARD + BOOTSTRAP API
// ==========================================

app.get("/api/dashboard", async (req, res) => {
  try {
    const { business } = req.query;

    if (unknownBusiness(business)) {
      return res.status(400).json({ error: "Unknown business" });
    }

    return res.json(await dashboardTotals(req, business));
  } catch (error) {
    console.error("Dashboard error:", error.message);
    return res.status(500).json({ error: "Failed to load dashboard" });
  }
});

// Everything the app needs right after sign-in, in ONE request (and gzipped):
// companies, every list of every business, and the dashboard totals.
// Lists an account may not read are simply left out.
const BOOT_LISTS = ["purchases", "sales", "payments", "rents", "orders"];

const canReadList = (req, key) => {
  const { ownerOnly, viewerCanRead } = resources[key];
  return !ownerOnly || isOwner(req) || (viewerCanRead && isViewer(req));
};

const addTotals = (a, b) =>
  Object.fromEntries(Object.keys(a).map((k) => [k, a[k] + (b[k] || 0)]));

app.get("/api/bootstrap", async (req, res) => {
  const started = Date.now();

  try {
    const db = req.supabase;
    const keys = BOOT_LISTS.filter((key) => canReadList(req, key));

    const [companies, perBusiness] = await Promise.all([
      listQuery(db, "companies"),
      Promise.all(
        BUSINESSES.map(async (business) => {
          const [stats, ...lists] = await Promise.all([
            dashboardTotals(req, business),
            ...keys.map((key) => listQuery(db, key, { business })),
          ]);

          const failed = lists.find((l) => l.error);
          if (failed) throw failed.error;

          return {
            business,
            stats,
            lists: Object.fromEntries(keys.map((k, i) => [k, lists[i].data])),
          };
        }),
      ),
    ]);

    if (companies.error) throw companies.error;

    const payload = {
      companies: companies.data,
      stats: {
        "": perBusiness.map((b) => b.stats).reduce(addTotals),
        ...Object.fromEntries(perBusiness.map((b) => [b.business, b.stats])),
      },
      data: Object.fromEntries(perBusiness.map((b) => [b.business, b.lists])),
    };

    const queried = Date.now();
    const json = JSON.stringify(payload);
    res.set("Vary", "Accept-Encoding");

    let body = json;
    if (/\bgzip\b/.test(req.headers["accept-encoding"] || "")) {
      // level 1: much less CPU on a small server, still ~85% smaller
      body = await gzipAsync(json, { level: 1 });
      res.set({
        "Content-Type": "application/json; charset=utf-8",
        "Content-Encoding": "gzip",
      });
    } else {
      res.type("json");
    }

    // shows up in the browser's Network > Timing tab and in the Render logs
    const done = Date.now();
    const timing = `db;dur=${queried - started}, pack;dur=${done - queried}`;
    res.set("Server-Timing", timing);
    console.log(
      `bootstrap: ${timing}, ${(json.length / 1024).toFixed(0)} KB -> ${(body.length / 1024).toFixed(0)} KB sent`,
    );

    return res.send(body);
  } catch (error) {
    console.error("Bootstrap error:", error.message);
    return res.status(500).json({ error: "Failed to load data" });
  }
});

// ==========================================
// 9. GLOBAL ERROR HANDLER
// ==========================================

app.use((err, req, res, next) => {
  console.error("Server error:", err.message);

  if (res.headersSent) {
    return next(err);
  }

  return res.status(500).json({
    error: "Internal server error",
  });
});

// ==========================================
// 10. START SERVER
// ==========================================

const PORT = Number(process.env.PORT) || 5000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`API listening on port ${PORT}`);
});
