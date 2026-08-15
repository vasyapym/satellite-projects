import Link from "next/link";
import type { ProjectEntry } from "@/lib/manifest.types";

function Tags({ tags }: { tags: string[] }) {
  return (
    <div className="tags">
      {tags.map((t) => (
        <span key={t} className="tag">{t}</span>
      ))}
    </div>
  );
}

function CardBody({ project }: { project: ProjectEntry }) {
  return (
    <>
      <span className="status">
        {project.status === "live" ? "live" : project.status.replace("-", " ")}
      </span>
      <h3>{project.title}</h3>
      <p>{project.description}</p>
      <Tags tags={project.tags} />
    </>
  );
}

export function ProjectCard({ project }: { project: ProjectEntry }) {
  // Non-live projects degrade gracefully — no dead links.
  if (project.status !== "live") {
    return (
      <article className="project-card project-card--muted" aria-disabled>
        <CardBody project={project} />
      </article>
    );
  }

  const external = project.link.kind === "external";
  const className = "project-card";

  if (external) {
    return (
      <a
        className={className}
        href={project.link.href}
        target="_blank"
        rel="noopener noreferrer"
      >
        <CardBody project={project} />
      </a>
    );
  }

  return (
    <Link className={className} href={project.link.href}>
      <CardBody project={project} />
    </Link>
  );
}
