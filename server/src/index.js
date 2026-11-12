import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import { createClient } from "@supabase/supabase-js";

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

async function requireAuth(req, res, next) {
  try {
    const token = req.headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1];

    if (!token) {
      return res.status(401).json({
        error: "Sign in required",
      });
    }

    // Create a Supabase client using the user's JWT.
    // RLS will enforce database access permissions.

    const userSupabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_ANON_KEY,
      {
        global: {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
        auth: {
          autoRefreshToken: false,
          persistSession: false,
          detectSessionInUrl: false,
        },
      },
    );

    const {
      data: { user },
      error,
    } = await userSupabase.auth.getUser(token);

    if (error || !user) {
      return res.status(401).json({
        error: "Invalid or expired session",
      });
    }

    req.user = user;
    req.supabase = userSupabase;

    next();
  } catch (error) {
    console.error("Authentication error:", error.message);

    return res.status(500).json({
      error: "Authentication service error",
    });
  }
}

// Protect all API routes.
app.use("/api", requireAuth);

// The owner is a user whose Supabase app_metadata has role = "owner".
// app_metadata can only be changed from the Supabase dashboard / SQL,
// never by the user, so it is safe to trust.
const isOwner = (req) => req.user?.app_metadata?.role === "owner";

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
      "seller",
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
    fields: [
      "company_id",
      "payment_date",
      "direction",
      "amount",
      "reference",
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
      isOwner(req)
        ? next()
        : res.status(403).json({ error: "Only the owner can access this." }),
    );
  }

  // GET RECORDS
  app.get(`/api/${key}`, async (req, res) => {
    try {
      let query = req.supabase
        .from(table)
        .select("*")
        .order("created_at", { ascending: false })
        .limit(500);

      // purchases / sales / payments / rents belong to one business
      if (config.scoped && req.query.business) {
        if (!BUSINESSES.includes(req.query.business)) {
          return res.status(400).json({ error: "Unknown business" });
        }
        query = query.eq("business", req.query.business);
      }

      if (key === "companies" && req.query.search) {
        query = query.ilike(
          "name",
          `%${String(req.query.search).slice(0, 100)}%`,
        );
      }

      const { data, error } = await query;

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

      if (config.scoped) {
        const business = req.body?.business || "DDGS";

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

      const { data, error } = await req.supabase
        .from(table)
        .update(payload)
        .eq("id", req.params.id)
        .eq("owner_id", req.user.id)
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
            "This record no longer exists. Refresh the page and try again.",
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
      const { data, error } = await req.supabase
        .from(table)
        .delete()
        .eq("id", req.params.id)
        .eq("owner_id", req.user.id)
        .select("id");

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
// 8. DASHBOARD API
// ==========================================

app.get("/api/dashboard", async (req, res) => {
  try {
    const db = req.supabase;

    // optional ?business= limits the totals to one business
    const business = req.query.business;

    if (business && !BUSINESSES.includes(business)) {
      return res.status(400).json({ error: "Unknown business" });
    }

    const scope = (query) =>
      business ? query.eq("business", business) : query;
    const owner = isOwner(req);

    const [p, s, received, paid] = await Promise.all([
      scope(db.from("purchases").select("purchase_total")),

      scope(db.from("sales").select("gross_total")),

      owner
        ? scope(
            db.from("payments").select("amount").eq("direction", "received"),
          )
        : Promise.resolve({ data: [], error: null }),

      owner
        ? scope(db.from("payments").select("amount").eq("direction", "paid"))
        : Promise.resolve({ data: [], error: null }),
    ]);

    const errors = [p.error, s.error, received.error, paid.error].filter(
      Boolean,
    );

    if (errors.length) {
      console.error("Dashboard error:", errors[0].message);

      return res.status(400).json({
        error: errors[0].message,
      });
    }

    const sum = (rows, key) =>
      (rows || []).reduce((total, row) => total + Number(row[key] || 0), 0);

    const sales = sum(s.data, "gross_total");
    const purchases = sum(p.data, "purchase_total");

    const collected = sum(received.data, "amount");
    const disbursed = sum(paid.data, "amount");

    // payment figures are for the owner only
    if (!owner) {
      return res.json({ sales, purchases });
    }

    return res.json({
      sales,
      purchases,
      collected,
      disbursed,
      receivable: sales - collected,
      payable: purchases - disbursed,
      net: collected - disbursed,
    });
  } catch (error) {
    console.error("Dashboard error:", error.message);

    return res.status(500).json({
      error: "Failed to load dashboard",
    });
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
