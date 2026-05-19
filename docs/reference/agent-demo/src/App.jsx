import { useMemo } from "react";
import { TodoContext } from "./context/TodoContext";
import { useTodos } from "./hooks/useTodos";
import { TodoHeader } from "./components/TodoHeader/TodoHeader";
import { TodoForm } from "./components/TodoForm/TodoForm";
import { TodoFilter } from "./components/TodoFilter/TodoFilter";
import { TodoList } from "./components/TodoList/TodoList";
import { TodoFooter } from "./components/TodoFooter/TodoFooter";
import styles from "./App.module.css";

export default function App() {
  const { state, dispatch, filteredTodos } = useTodos();

  const activeCount = useMemo(
    () => state.todos.filter((t) => !t.completed).length,
    [state.todos]
  );

  return (
    <TodoContext.Provider value={{ filter: state.filter, dispatch }}>
      <div className={styles.container}>
        <TodoHeader />
        <main className={styles.card}>
          <TodoForm />
          <TodoFilter />
          <TodoList todos={filteredTodos} />
          <TodoFooter activeCount={activeCount} />
        </main>
      </div>
    </TodoContext.Provider>
  );
}
