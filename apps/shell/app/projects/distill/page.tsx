import Link from "next/link";
import { Distill } from "./Distill";
import styles from "./distill.module.css";

export const metadata = {
  title: "Distill — structural code summarizer",
  description: "Paste source; get a dense, LLM-ready structural summary.",
};

export default function DistillPage() {
  return (
    <div className="container">
      <div className={styles.wrap}>
        <Link href="/" className={styles.back}>← Back to projects</Link>
        <header className={styles.header}>
          <h1>Distill</h1>
          <p>
            Distill returns a dense, low-token
            layout meant to
            hand to an LLM in place of the full source.
          </p>
        </header>
        <Distill />
      </div>
    </div>
  );
}
