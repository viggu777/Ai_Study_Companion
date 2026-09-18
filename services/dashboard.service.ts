import { getDb } from "@/lib/db/supabase";
import { getCurrentUserId } from "@/lib/auth/getCurrentUser";
import { getGrowthAnalysis, type Trend } from "./growth.service";

export interface DashboardRecentProject {
  id: string;
  name: string;
  description: string | null;
  learning_goal: string | null;
  space_id: string;
  spaceName: string | null;
  created_at: string;
  updated_at: string;
  /** Latest learning_events.created_at for this project, or null when no activity yet. */
  lastActivityAt: string | null;
  materialsCount: number;
  conceptsCount: number;
}

export interface AttentionItem {
  projectId: string;
  projectName: string;
  conceptId: string;
  conceptName: string;
  score: number | null;
  trend: Trend;
}

export interface DashboardNextAction {
  recommendationId: string;
  projectId: string;
  projectName: string;
  title: string;
  action_items: string[];
  created_at: string;
}

export interface DashboardData {
  recentProjects: DashboardRecentProject[];
  /** Most relevant/recent project to continue learning, or null when no projects exist. */
  continueLearning: DashboardRecentProject | null;
  /** Weak concepts across recent projects, weakest / most urgent first. */
  attentionItems: AttentionItem[];
  /** Latest ACTIVE recommendations across the user's projects. */
  nextActions: DashboardNextAction[];
}

const RECENT_PROJECT_LIMIT = 12;
const RECENT_PROJECTS_SHOWN = 6;
const ATTENTION_PROJECT_LIMIT = 5;
const ATTENTION_ITEM_LIMIT = 5;
const NEXT_ACTION_LIMIT = 3;
const RECENT_EVENT_LIMIT = 150;

type ProjectRow = {
  id: string;
  space_id: string;
  name: string;
  description: string | null;
  learning_goal: string | null;
  created_at: string;
  updated_at: string;
};

/**
 * Sort projects by real activity first, then recency.
 * Pure helper kept separate for testability.
 */
export function sortProjectsByActivity<T extends { id: string; updated_at: string }>(
  projects: T[],
  lastActivityByProject: Map<string, string>
): T[] {
  return [...projects].sort((a, b) => {
    const aAct = lastActivityByProject.get(a.id) ?? null;
    const bAct = lastActivityByProject.get(b.id) ?? null;
    if (aAct && bAct) return bAct.localeCompare(aAct);
    if (aAct) return -1;
    if (bAct) return 1;
    return b.updated_at.localeCompare(a.updated_at);
  });
}

/**
 * Rank attention items: REQUIRES_ATTENTION first, then lowest mastery score
 * (untested/null counts as 0 so gaps surface at the top).
 */
export function rankAttentionItems(items: AttentionItem[]): AttentionItem[] {
  return [...items].sort((a, b) => {
    const aUrgent = a.trend === "REQUIRES_ATTENTION" ? 0 : 1;
    const bUrgent = b.trend === "REQUIRES_ATTENTION" ? 0 : 1;
    if (aUrgent !== bUrgent) return aUrgent - bUrgent;
    return (a.score ?? 0) - (b.score ?? 0);
  });
}

/**
 * Home-dashboard data, assembled from existing sources only:
 * - projects/spaces (ownership-scoped, RLS + user_id)
 * - learning_events for "where was I" recency (real activity, never invented)
 * - getGrowthAnalysis per recent project for weak-concept detection
 *   (reuses the deterministic mastery/growth logic — no second formula)
 * - ACTIVE recommendations for the "what next" card
 *
 * All independent reads are parallelized; per-project growth reads run in
 * parallel and degrade to [] individually so one failure never blanks the page.
 */
export async function getDashboardData(): Promise<DashboardData> {
  const userId = await getCurrentUserId();
  const db = await getDb();

  const [spacesRes, projectsRes, eventsRes, recsRes] = await Promise.all([
    db.from("spaces").select("id, name").eq("user_id", userId),
    db
      .from("projects")
      .select("id, space_id, name, description, learning_goal, created_at, updated_at")
      .eq("user_id", userId)
      .order("updated_at", { ascending: false })
      .limit(RECENT_PROJECT_LIMIT),
    db
      .from("learning_events")
      .select("project_id, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(RECENT_EVENT_LIMIT),
    db
      .from("recommendations")
      .select("id, project_id, title, action_items, created_at")
      .eq("user_id", userId)
      .eq("status", "ACTIVE")
      .order("created_at", { ascending: false })
      .limit(NEXT_ACTION_LIMIT),
  ]);

  if (spacesRes.error) throw new Error(spacesRes.error.message);
  if (projectsRes.error) throw new Error(projectsRes.error.message);
  if (eventsRes.error) throw new Error(eventsRes.error.message);
  if (recsRes.error) throw new Error(recsRes.error.message);

  const spaceNameById = new Map<string, string>();
  for (const s of ((spacesRes.data ?? []) as Array<{ id: string; name: string }>)) {
    spaceNameById.set(s.id, s.name);
  }

  const projectRows = (projectsRes.data ?? []) as ProjectRow[];

  // Latest activity per project (events are already newest-first, keep first hit).
  const lastActivityByProject = new Map<string, string>();
  for (const e of ((eventsRes.data ?? []) as Array<{ project_id: string | null; created_at: string }>)) {
    if (e.project_id && !lastActivityByProject.has(e.project_id)) {
      lastActivityByProject.set(e.project_id, e.created_at);
    }
  }

  const sortedProjects = sortProjectsByActivity(projectRows, lastActivityByProject);
  const shownProjects = sortedProjects.slice(0, RECENT_PROJECTS_SHOWN);

  // Per-project material/concept counts for useful recent-project metadata.
  // Batched into two queries (not N per project).
  let materialsCountByProject = new Map<string, number>();
  let conceptsCountByProject = new Map<string, number>();
  if (shownProjects.length > 0) {
    const shownIds = shownProjects.map((p) => p.id);
    const [matsRes, conceptsRes] = await Promise.all([
      db.from("materials").select("project_id").eq("user_id", userId).in("project_id", shownIds),
      db.from("concepts").select("project_id").in("project_id", shownIds),
    ]);
    if (!matsRes.error) {
      for (const m of ((matsRes.data ?? []) as Array<{ project_id: string }>)) {
        materialsCountByProject.set(m.project_id, (materialsCountByProject.get(m.project_id) ?? 0) + 1);
      }
    }
    if (!conceptsRes.error) {
      for (const c of ((conceptsRes.data ?? []) as Array<{ project_id: string }>)) {
        conceptsCountByProject.set(c.project_id, (conceptsCountByProject.get(c.project_id) ?? 0) + 1);
      }
    }
  }

  const recentProjects: DashboardRecentProject[] = shownProjects.map((p) => ({
    id: p.id,
    name: p.name,
    description: p.description,
    learning_goal: p.learning_goal,
    space_id: p.space_id,
    spaceName: spaceNameById.get(p.space_id) ?? null,
    created_at: p.created_at,
    updated_at: p.updated_at,
    lastActivityAt: lastActivityByProject.get(p.id) ?? null,
    materialsCount: materialsCountByProject.get(p.id) ?? 0,
    conceptsCount: conceptsCountByProject.get(p.id) ?? 0,
  }));

  const continueLearning = recentProjects.length > 0 ? recentProjects[0] : null;

  // Weak concepts across the most relevant projects, reusing growth logic.
  const projectNameById = new Map<string, string>(projectRows.map((p) => [p.id, p.name]));
  const growthTargets = sortedProjects.slice(0, ATTENTION_PROJECT_LIMIT);
  const growthResults = await Promise.all(
    growthTargets.map((p) => getGrowthAnalysis(p.id).catch(() => []))
  );
  const weakItems: AttentionItem[] = [];
  growthResults.forEach((growth, idx) => {
    const project = growthTargets[idx];
    for (const g of growth) {
      const score = g.currentScore;
      const isWeak = g.trend === "REQUIRES_ATTENTION" || (score ?? 0) < 60;
      if (!isWeak) continue;
      weakItems.push({
        projectId: project.id,
        projectName: projectNameById.get(project.id) ?? project.name,
        conceptId: g.conceptId,
        conceptName: g.conceptName,
        score,
        trend: g.trend,
      });
    }
  });
  const attentionItems = rankAttentionItems(weakItems).slice(0, ATTENTION_ITEM_LIMIT);

  // Latest ACTIVE recommendations with their project names (real data only).
  const recRows = (recsRes.data ?? []) as Array<{
    id: string;
    project_id: string;
    title: string;
    action_items: unknown;
    created_at: string;
  }>;
  const nextActions: DashboardNextAction[] = recRows.map((r) => ({
    recommendationId: r.id,
    projectId: r.project_id,
    projectName: projectNameById.get(r.project_id) ?? "Project",
    title: r.title,
    action_items: Array.isArray(r.action_items) ? (r.action_items as string[]) : [],
    created_at: r.created_at,
  }));

  return { recentProjects, continueLearning, attentionItems, nextActions };
}
