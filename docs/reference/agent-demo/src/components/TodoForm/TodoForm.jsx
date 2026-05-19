import { useState } from "react";
import { useTodoContext } from "../../context/TodoContext";
import styles from "./TodoForm.module.css";

export function TodoForm() {
  const [text, setText] = useState("");
  const { dispatch } = useTodoContext();

  function handleSubmit(e) {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed) return;
    dispatch({ type: "ADD_TODO", text: trimmed });
    setText("");
  }

  return (
    <form className={styles.form} onSubmit={handleSubmit}>
      <input
        className={styles.input}
        type="text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="What needs to be done?"
        aria-label="新しいタスクを入力"
      />
      <button className={styles.button} type="submit" disabled={!text.trim()}>
        追加
      </button>
    </form>
  );
}
