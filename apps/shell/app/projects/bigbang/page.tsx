import Link from "next/link";
import { BigBang } from "./BigBang";
import styles from "./bigbang.module.css";

export const metadata = {
  title: "Big Bang — GPU particle cosmology",
  description:
    "A stylized WebGL2 particle simulation of the Big Bang.",
};

export default function BigBangPage() {
  return (
    <div className="container">
      <div className={styles.wrap}>
        <Link href="/" className={styles.back}>
          ← Back to projects
        </Link>
        <header className={styles.header}>
          <h1>Big Bang</h1>
          <p>
            A GPU-accelerated particle simulation rendered with WebGL2 and GLSL via transform feedback.
          </p>
        </header>
        <BigBang />
      </div>
    </div>
  );
}
