export type ProjectStatus = "live" | "in-progress" | "archived";

/** A satellite is reached through a link. Internal today, external once it
 *  graduates to an independently-deployed service (ADR-0002). */
export type ProjectLink =
  | { kind: "internal"; href: string }
  | { kind: "external"; href: string };

export interface ProjectEntry {
  slug: string;
  title: string;
  description: string;
  /** Languages / technologies this satellite demonstrates. */
  tags: string[];
  status: ProjectStatus;
  link: ProjectLink;
  year?: number;
}
