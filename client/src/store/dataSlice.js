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

// Data that belongs to ONE business. The selected business lives at the top
// level of the state; the others wait in state.cache so switching is instant.
const blankScoped = () => ({
  stats: null,
  statsAt: 0,
  statsLoading: false,
  lists: Object.fromEntries(
    LIST_PAGES.filter(isScoped).map((p) => [p, blankList()]),
  ),
  filters: Object.fromEntries(FILTER_PAGES.map((p) => [p, blankFilters()])),
});

const makeInitialState = () => ({
  business: "",
  cache: {}, // business -> blankScoped() shape, for businesses not selected
  stats: null,
  statsAt: 0,
  statsLoading: false,
  lists: Object.fromEntries(LIST_PAGES.map((p) => [p, blankList()])),
  filters: Object.fromEntries(FILTER_PAGES.map((p) => [p, blankFilters()])),
  sortDir: Object.fromEntries(FILTER_PAGES.map((p) => [p, "desc"])), // newest first
  error: "",
});

// Where the data for (page, business) is stored.
// Companies are shared, so they always live at the top level.
const holder = (state, page, business) => {
  const b = business || "";
  if (page && !isScoped(page)) return state;
  if (b === state.business) return state;
  if (!state.cache[b]) state.cache[b] = blankScoped();
  return state.cache[b];
};

// Read-only version used by thunk conditions (never creates anything).
const peek = (data, page, business) => {
  const b = business || "";
  if (page && !isScoped(page)) return data;
  if (b === data.business) return data;
  return data.cache[b] || blankScoped();
};

// =====================================================
// THUNKS
// `api` is the authenticated fetch helper from App.jsx.
// `force: true` skips the freshness check.
// =====================================================

export const fetchStats = createAsyncThunk(
  "data/fetchStats",
  async ({ api, business }) => api(withBusiness("dashboard", business)),
  {
    condition: ({ force, business } = {}, { getState }) => {
      const { statsLoading, statsAt } = peek(
        getState().data,
        undefined,
        business,
      );
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
    condition: ({ page, force, business } = {}, { getState }) => {
      if (!LIST_PAGES.includes(page)) return false;

      const list = peek(getState().data, page, business).lists[page];
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
      // the combined dashboard ("") also changes when a business changes
      if (business)
        jobs.push(dispatch(fetchStats({ api, business: "", force: true })));
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
      if (business) dispatch(fetchStats({ api, business: "", force: true }));
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

    // Switching business (sidebar folder): park the current business's data in
    // the cache and bring the other one back. Companies are shared and stay.
    setBusiness(state, { payload }) {
      const next = payload || "";
      if (next === state.business) return;

      const { Companies, ...scopedLists } = state.lists;

      state.cache[state.business] = {
        stats: state.stats,
        statsAt: state.statsAt,
        statsLoading: state.statsLoading,
        lists: scopedLists,
        filters: state.filters,
      };

      const incoming = state.cache[next] || blankScoped();
      delete state.cache[next];

      state.business = next;
      state.stats = incoming.stats;
      state.statsAt = incoming.statsAt;
      state.statsLoading = incoming.statsLoading;
      state.lists = { Companies, ...incoming.lists };
      state.filters = incoming.filters;
      state.error = "";
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
        holder(state, undefined, action.meta.arg.business).statsLoading = true;
      })
      .addCase(fetchStats.fulfilled, (state, action) => {
        const h = holder(state, undefined, action.meta.arg.business);
        h.stats = action.payload;
        h.statsAt = Date.now();
        h.statsLoading = false;
      })
      .addCase(fetchStats.rejected, (state, action) => {
        if (action.meta.condition) return;
        holder(state, undefined, action.meta.arg.business).statsLoading = false;
        state.error = action.error.message || "Could not load dashboard.";
      })

      // ---- lists
      .addCase(fetchList.pending, (state, action) => {
        const { page, business } = action.meta.arg;
        holder(state, page, business).lists[page].loading = true;
      })
      .addCase(fetchList.fulfilled, (state, action) => {
        const { page, business, items } = action.payload;
        const list = holder(state, page, business).lists[page];

        // Safety net: only keep rows of that business. Rows without a
        // business value (old backend / migration not run) count as DDGS.
        list.items =
          business && isScoped(page)
            ? items.filter((item) => (item.business || "DDGS") === business)
            : items;
        list.loaded = true;
        list.loading = false;
        list.fetchedAt = Date.now();
      })
      .addCase(fetchList.rejected, (state, action) => {
        if (action.meta.condition) return;
        const { page, business } = action.meta.arg;
        holder(state, page, business).lists[page].loading = false;
        state.error = action.error.message || "Could not load records.";
      })

      // ---- optimistic delete: row disappears instantly, restored on failure
      .addCase(deleteRecord.pending, (state, action) => {
        const { page, id, business } = action.meta.arg;
        const list = holder(state, page, business).lists[page];
        list.backup = list.items;
        list.items = list.items.filter((item) => item.id !== id);
      })
      .addCase(deleteRecord.fulfilled, (state, action) => {
        const { page, business } = action.meta.arg;
        holder(state, page, business).lists[page].backup = null;
      })
      .addCase(deleteRecord.rejected, (state, action) => {
        const { page, business } = action.meta.arg;
        const list = holder(state, page, business).lists[page];
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
