import styles from "./TodoFooter.module.css";

export function TodoFooter({ activeCount }) {
  return (
    <footer className={styles.footer}>
      <span>{activeCount} 件残っています</span>
    </footer>
  );
}
