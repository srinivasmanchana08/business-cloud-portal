import { createSlice, createAsyncThunk } from "@reduxjs/toolkit";

// =====================================================
// CONSTANTS
// =====================================================

// Cached data younger than this is shown without re-fetching.
const STALE_MS = 60 * 1000;

export const LIST_PAGES = [
  "Companies",
  "Purchases",
  "Sales",
  "Payments",
  "Rents",
];
export const FILTER_PAGES = ["Purchases", "Sales", "Payments"];

// Everything except Companies is kept separately per business
// (the sidebar folders DDGS / Maize and Turmeric). "" = all businesses.
const isScoped = (page) => page !== "Companies";

const withBusiness = (path, business) =>
  business ? `${path}?business=${encodeURIComponent(business)}` : path;

// ignore responses that belong to a business that is no longer selected
const isStale = (state, arg) =>
  (arg.business || "") !== state.business &&
  (arg.page === undefined || isScoped(arg.page));

const blankFilters = () => ({
  company: "",
  from: "",
  to: "",
  direction: "", // Payments only
});

const blankList = () => ({
  items: [],
  loaded: false,
  loading: false,
  fetchedAt: 0,
  backup: null, // used to roll back an optimistic delete
});

const makeInitialState = () => ({
  business: "",
  stats: null,
  statsAt: 0,
  statsLoading: false,
  lists: Object.fromEntries(LIST_PAGES.map((p) => [p, blankList()])),
  filters: Object.fromEntries(FILTER_PAGES.map((p) => [p, blankFilters()])),
  sortDir: Object.fromEntries(FILTER_PAGES.map((p) => [p, "desc"])), // newest first
  error: "",
});

// =====================================================
// THUNKS
// `api` is the authenticated fetch helper from App.jsx.
// `force: true` skips the freshness check.
// =====================================================

export const fetchStats = createAsyncThunk(
  "data/fetchStats",
  async ({ api, business }) => api(withBusiness("dashboard", business)),
  {
    condition: ({ force } = {}, { getState }) => {
      const { statsLoading, statsAt } = getState().data;
      if (!force && statsLoading) return false;
      if (!force && Date.now() - statsAt < STALE_MS) return false;
      return true;
    },
  },
);

export const fetchList = createAsyncThunk(
  "data/fetchList",
  async ({ api, page, business }) => ({
    page,
    business,
    items: await api(
      isScoped(page)
        ? withBusiness(page.toLowerCase(), business)
        : page.toLowerCase(),
    ),
  }),
  {
    condition: ({ page, force } = {}, { getState }) => {
      const list = getState().data.lists[page];
      if (!list) return false;
      if (!force && list.loading) return false;
      if (!force && list.loaded && Date.now() - list.fetchedAt < STALE_MS) {
        return false;
      }
      return true;
    },
  },
);

export const saveRecord = createAsyncThunk(
  "data/saveRecord",
  async ({ api, page, id, body, business }, { dispatch }) => {
    const endpoint = `${page.toLowerCase()}${id ? `/${id}` : ""}`;

    await api(endpoint, {
      method: id ? "PUT" : "POST",
      body: JSON.stringify(
        isScoped(page) && business ? { ...body, business } : body,
      ),
    });

    // Refresh the list (and dashboard totals) so the cache is correct.
    const jobs = [dispatch(fetchList({ api, page, business, force: true }))];
    if (page !== "Companies" && page !== "Rents") {
      jobs.push(dispatch(fetchStats({ api, business, force: true })));
    }
    await Promise.all(jobs);
  },
);

export const deleteRecord = createAsyncThunk(
  "data/deleteRecord",
  async ({ api, page, id, business }, { dispatch }) => {
    await api(`${page.toLowerCase()}/${id}`, { method: "DELETE" });

    if (page !== "Companies" && page !== "Rents") {
      dispatch(fetchStats({ api, business, force: true }));
    }
  },
);

// =====================================================
// SLICE
// =====================================================

const dataSlice = createSlice({
  name: "data",
  initialState: makeInitialState(),

  reducers: {
    setFilter(state, { payload: { page, key, value } }) {
      state.filters[page][key] = value;
    },

    clearFilters(state, { payload: page }) {
      state.filters[page] = blankFilters();
    },

    toggleSort(state, { payload: page }) {
      state.sortDir[page] = state.sortDir[page] === "desc" ? "asc" : "desc";
    },

    // Switching business (sidebar folder) clears the cached business data.
    // Companies are shared, so that list is kept.
    setBusiness(state, { payload }) {
      const next = payload || "";
      if (next === state.business) return;

      state.business = next;
      state.stats = null;
      state.statsAt = 0;
      state.statsLoading = false;
      state.error = "";

      LIST_PAGES.filter(isScoped).forEach((p) => {
        state.lists[p] = blankList();
      });
      FILTER_PAGES.forEach((p) => {
        state.filters[p] = blankFilters();
      });
    },

    clearError(state) {
      state.error = "";
    },

    // Called on sign-out so the next user never sees cached data.
    clearData() {
      return makeInitialState();
    },
  },

  extraReducers: (builder) => {
    builder
      // ---- dashboard stats
      .addCase(fetchStats.pending, (state, action) => {
        if (isStale(state, action.meta.arg)) return;
        state.statsLoading = true;
      })
      .addCase(fetchStats.fulfilled, (state, action) => {
        if (isStale(state, action.meta.arg)) return;
        const payload = action.payload;
        state.stats = payload;
        state.statsAt = Date.now();
        state.statsLoading = false;
      })
      .addCase(fetchStats.rejected, (state, action) => {
        if (isStale(state, action.meta.arg)) return;
        state.statsLoading = false;
        state.error = action.error.message || "Could not load dashboard.";
      })

      // ---- lists
      .addCase(fetchList.pending, (state, action) => {
        if (isStale(state, action.meta.arg)) return;
        state.lists[action.meta.arg.page].loading = true;
      })
      .addCase(fetchList.fulfilled, (state, action) => {
        if (isStale(state, action.meta.arg)) return;
        const payload = action.payload;
        const list = state.lists[payload.page];
        // Safety net: only keep rows of the selected business. Rows without a
        // business value (old backend / migration not run) count as DDGS.
        list.items = payload.business
          ? payload.items.filter(
              (item) => (item.business || "DDGS") === payload.business,
            )
          : payload.items;
        list.loaded = true;
        list.loading = false;
        list.fetchedAt = Date.now();
      })
      .addCase(fetchList.rejected, (state, action) => {
        if (isStale(state, action.meta.arg)) return;
        state.lists[action.meta.arg.page].loading = false;
        state.error = action.error.message || "Could not load records.";
      })

      // ---- optimistic delete: row disappears instantly, restored on failure
      .addCase(deleteRecord.pending, (state, action) => {
        const { page, id } = action.meta.arg;
        const list = state.lists[page];
        list.backup = list.items;
        list.items = list.items.filter((item) => item.id !== id);
      })
      .addCase(deleteRecord.fulfilled, (state, action) => {
        state.lists[action.meta.arg.page].backup = null;
      })
      .addCase(deleteRecord.rejected, (state, action) => {
        const list = state.lists[action.meta.arg.page];
        if (list.backup) list.items = list.backup;
        list.backup = null;
      });
  },
});

export const {
  setFilter,
  clearFilters,
  toggleSort,
  setBusiness,
  clearError,
  clearData,
} = dataSlice.actions;

export default dataSlice.reducer;
