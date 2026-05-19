import { useTodoContext } from "../../context/TodoContext";
import styles from "./TodoFilter.module.css";

const FILTERS = [
  { value: "all", label: "全件" },
  { value: "active", label: "未完了" },
  { value: "completed", label: "完了" },
];

export function TodoFilter() {
  const { filter, dispatch } = useTodoContext();

  return (
    <nav className={styles.nav} aria-label="フィルター">
      {FILTERS.map(({ value, label }) => (
        <button
          key={value}
          className={`${styles.tab} ${filter === value ? styles.active : ""}`}
          onClick={() => dispatch({ type: "SET_FILTER", filter: value })}
          aria-current={filter === value ? "true" : undefined}
        >
          {label}
        </button>
      ))}
    </nav>
  );
}
