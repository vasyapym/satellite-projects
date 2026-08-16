import type { Metadata } from "next";
import { BigBangLoader } from "./components/BigBangLoader";
import "./bigbang.module.css";

export const metadata: Metadata = {
  title: "Big Bang · Rust + WebAssembly",
  description:
    "A physically-grounded Big Bang simulation: Friedmann expansion, a cooling thermal history, and Barnes–Hut N-body structure formation, rendered on the GPU.",
};

export default function Page() {
  return (
    <main className="container">
      <section className="hero" style={{ paddingBottom: "var(--space-4)" }}>
        <h1>Big Bang</h1>
        <p>
          The scale factor evolves from the Friedmann equations while a Barnes–Hut N-body
          core clusters matter under gravity — all in Rust, compiled to WebAssembly.
        </p>
      </section>
      <BigBangLoader />
    </main>
  );
}
