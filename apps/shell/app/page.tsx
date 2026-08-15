import { projects } from "@/lib/manifest";
import { ProjectCard } from "@/components/ProjectCard";

export default function HomePage() {
  return (
    <div className="container">
      <section className="hero">
        <h1>Playground</h1>
        <p>
          A small, stable shell that hosts self-contained projects.
        </p>
      </section>

      <section className="project-grid">
        {projects.map((p) => (
          <ProjectCard key={p.slug} project={p} />
        ))}
      </section>
    </div>
  );
}
