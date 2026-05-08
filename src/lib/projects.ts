import type { DatasetProject } from "../types";

export function findProject(
  projects: DatasetProject[],
  id?: string
): DatasetProject | undefined {
  if (!id) return undefined;

  for (const project of projects) {
    if (project.id === id) return project;
    const child = findProject(project.children ?? [], id);
    if (child) return child;
  }

  return undefined;
}

export function findProjectTrail(
  projects: DatasetProject[],
  projectId: string | undefined,
  parents: DatasetProject[] = []
): DatasetProject[] {
  if (!projectId) return [];

  for (const project of projects) {
    const trail = [...parents, project];
    if (project.id === projectId) return trail;

    const childTrail = findProjectTrail(project.children ?? [], projectId, trail);
    if (childTrail.length) return childTrail;
  }

  return [];
}

export function flattenProjects(projects: DatasetProject[]): DatasetProject[] {
  return projects.flatMap((project) => [project, ...flattenProjects(project.children ?? [])]);
}

export function formatProjectPath(projects: DatasetProject[], id?: string) {
  return findProjectTrail(projects, id)
    ?.map((project) => project.name)
    .filter(Boolean)
    .join(" / ");
}
