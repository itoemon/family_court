import { useReducer, useEffect, useMemo } from "react";

const STORAGE_KEY = "todos-state";

const initialState = {
  todos: [],
  filter: "all",
};

function reducer(state, action) {
  switch (action.type) {
    case "ADD_TODO":
      return {
        ...state,
        todos: [
          {
            id: crypto.randomUUID(),
            text: action.text,
            completed: false,
            createdAt: Date.now(),
          },
          ...state.todos,
        ],
      };
    case "TOGGLE_TODO":
      return {
        ...state,
        todos: state.todos.map((t) =>
          t.id === action.id ? { ...t, completed: !t.completed } : t
        ),
      };
    case "DELETE_TODO":
      return {
        ...state,
        todos: state.todos.filter((t) => t.id !== action.id),
      };
    case "SET_FILTER":
      return { ...state, filter: action.filter };
    default:
      return state;
  }
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : initialState;
  } catch {
    return initialState;
  }
}

export function useTodos() {
  const [state, dispatch] = useReducer(reducer, undefined, loadState);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [state]);

  const filteredTodos = useMemo(() => {
    if (state.filter === "active") return state.todos.filter((t) => !t.completed);
    if (state.filter === "completed") return state.todos.filter((t) => t.completed);
    return state.todos;
  }, [state.todos, state.filter]);

  return { state, dispatch, filteredTodos };
}
