import { useTodoContext } from "../../context/TodoContext";
import styles from "./TodoItem.module.css";

export function TodoItem({ todo }) {
  const { dispatch } = useTodoContext();

  return (
    <li className={`${styles.item} ${todo.completed ? styles.completed : ""}`}>
      <input
        className={styles.checkbox}
        type="checkbox"
        checked={todo.completed}
        onChange={() => dispatch({ type: "TOGGLE_TODO", id: todo.id })}
        aria-label={`${todo.text} を完了にする`}
      />
      <span className={styles.text}>{todo.text}</span>
      <button
        className={styles.deleteBtn}
        onClick={() => dispatch({ type: "DELETE_TODO", id: todo.id })}
        aria-label={`${todo.text} を削除`}
      >
        ×
      </button>
    </li>
  );
}
