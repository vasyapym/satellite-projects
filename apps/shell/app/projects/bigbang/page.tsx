import Link from "next/link";
import { BigBang } from "./BigBang";
import styles from "./bigbang.module.css";

export const metadata = {
  title: "Big Bang — GPU particle cosmology",
  description:
    "A stylized WebGL2 particle simulation of the Big Bang: singularity, inflation, expansion, cooling, and structure formation.",
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
            A GPU-accelerated particle simulation rendered with WebGL2 and GLSL,
            driven entirely on the GPU via transform feedback. It is a stylized
            visualization — not a scientific model — of the cosmic sequence:
            singularity, rapid inflation, expansion, cooling, and the emergence
            of large-scale structure.
          </p>
        </header>
        <BigBang />
      </div>
    </div>
  );
}
