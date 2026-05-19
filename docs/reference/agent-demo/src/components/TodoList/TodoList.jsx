import { TodoItem } from "../TodoItem/TodoItem";
import styles from "./TodoList.module.css";

export function TodoList({ todos }) {
  if (todos.length === 0) {
    return <p className={styles.empty}>タスクがありません</p>;
  }

  return (
    <ul className={styles.list}>
      {todos.map((todo) => (
        <TodoItem key={todo.id} todo={todo} />
      ))}
    </ul>
  );
}
