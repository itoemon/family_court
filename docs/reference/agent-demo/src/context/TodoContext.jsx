import { createContext, useContext } from "react";

export const TodoContext = createContext(null);

export function useTodoContext() {
  const ctx = useContext(TodoContext);
  if (!ctx) throw new Error("useTodoContext must be used within TodoContext.Provider");
  return ctx;
}
