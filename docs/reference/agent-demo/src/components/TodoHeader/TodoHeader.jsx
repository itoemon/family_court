import styles from "./TodoHeader.module.css";

export function TodoHeader() {
  return (
    <header className={styles.header}>
      <h1 className={styles.title}>Todo</h1>
    </header>
  );
}
