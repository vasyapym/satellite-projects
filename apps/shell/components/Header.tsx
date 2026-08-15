import Link from "next/link";

export function Header() {
  return (
    <header className="site-header">
      <div className="container">
        <Link href="/" className="brand">
          vasyapym<span style={{ color: "var(--color-accent)" }}>.dev</span>
        </Link>
        <nav>
          <Link href="/">Projects</Link>
        </nav>
      </div>
    </header>
  );
}
