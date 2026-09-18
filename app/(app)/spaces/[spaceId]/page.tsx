import { getCurrentUser } from "@/lib/auth/getCurrentUser";
import Link from "next/link";
import { getSpace, listProjects } from "@/services/project.service";
import { notFound } from "next/navigation";
import { ArrowRightIcon, FolderIcon, PlusIcon } from "@/components/icons";
import { EmptyState, LinkButton } from "@/components/ui";

export default async function SpacePage({
  params,
}: {
  params: Promise<{ spaceId: string }>;
}) {
  const { spaceId } = await params;
  await getCurrentUser();
  // Independent queries — start together so DB round-trips overlap.
  const spacePromise = getSpace(spaceId);
  const projectsPromise = listProjects(spaceId);
  const space = await spacePromise;
  if (!space) notFound();
  const projects = await projectsPromise;

  return (
    <div className="page-enter">
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <p className="min-w-0 flex-1 text-sm text-stone-500">{space.description || "Projects in this space."}</p>
        <LinkButton href={`/spaces/${spaceId}/projects/new`} size="sm">
          <PlusIcon className="h-4 w-4" />
          New Project
        </LinkButton>
      </div>
      {projects.length === 0 ? (
        <EmptyState
          icon={<FolderIcon className="h-5 w-5" />}
          title="No projects yet"
          description="Create your first project to upload materials and start learning."
          action={
            <LinkButton href={`/spaces/${spaceId}/projects/new`}>
              <PlusIcon className="h-4 w-4" />
              Create a Project
            </LinkButton>
          }
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {projects.map((project) => (
            <Link
              key={project.id}
              href={`/projects/${project.id}`}
              prefetch
              className="group rounded-xl border border-stone-200 bg-white p-5 shadow-card transition-all hover:-translate-y-0.5 hover:shadow-card-hover"
            >
              <div className="flex items-start justify-between gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-sky-50 text-sky-700">
                  <FolderIcon className="h-[18px] w-[18px]" />
                </span>
                <ArrowRightIcon className="h-4 w-4 shrink-0 text-stone-300 transition-all group-hover:translate-x-0.5 group-hover:text-stone-800" />
              </div>
              <h3 className="mt-3 font-semibold tracking-tight text-stone-900">{project.name}</h3>
              {project.description && (
                <p className="mt-1 line-clamp-2 text-sm text-stone-500">{project.description}</p>
              )}
              {project.learning_goal && (
                <p className="mt-1.5 line-clamp-1 text-xs text-stone-400">Goal: {project.learning_goal}</p>
              )}
              <p className="mt-3 text-xs text-stone-400">
                Created {new Date(project.created_at).toLocaleDateString()}
              </p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
