import { configureStore } from "@reduxjs/toolkit";
import dataReducer from "./dataSlice";

export const store = configureStore({
  reducer: {
    data: dataReducer,
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      // Thunks receive the `api` function in their arguments, and Redux puts
      // those arguments in action.meta.arg. Functions are not serializable,
      // so tell the dev-mode check to ignore just that one path.
      serializableCheck: {
        ignoredActionPaths: ["meta.arg.api"],
      },
    }),
});
