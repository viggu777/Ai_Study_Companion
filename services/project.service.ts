import { getDb } from "@/lib/db/supabase";
import { getCurrentUserId } from "@/lib/auth/getCurrentUser";

export async function createSpace(name: string, description?: string) {
  const userId = await getCurrentUserId();
  const db = await getDb();

  const { data, error } = await db
    .from("spaces")
    .insert({
      user_id: userId,
      name,
      description: description ?? null,
    })
    .select()
    .single();

  if (error) throw new Error(error.message);

  await emitLearningEvent({
    userId,
    spaceId: data.id,
    eventType: "SPACE_CREATED",
    entityType: "space",
    entityId: data.id,
    metadata: { name },
  });

  return data;
}

export async function listSpaces() {
  const userId = await getCurrentUserId();
  const db = await getDb();

  const { data, error } = await db
    .from("spaces")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function getSpace(spaceId: string) {
  const userId = await getCurrentUserId();
  const db = await getDb();

  const { data, error } = await db
    .from("spaces")
    .select("*")
    .eq("id", spaceId)
    .eq("user_id", userId)
    .single();

  if (error) {
    if (error.code === "PGRST116") return null;
    throw new Error(error.message);
  }
  return data;
}

export async function updateSpace(spaceId: string, name: string, description?: string) {
  const userId = await getCurrentUserId();
  const db = await getDb();

  const { data, error } = await db
    .from("spaces")
    .update({ name, description: description ?? null, updated_at: new Date().toISOString() })
    .eq("id", spaceId)
    .eq("user_id", userId)
    .select()
    .single();

  if (error) throw new Error(error.message);
  return data;
}

export async function deleteSpace(spaceId: string) {
  const userId = await getCurrentUserId();
  const db = await getDb();

  const { error } = await db
    .from("spaces")
    .delete()
    .eq("id", spaceId)
    .eq("user_id", userId);

  if (error) throw new Error(error.message);
}

export async function createProject(
  spaceId: string,
  name: string,
  description?: string,
  learningGoal?: string
) {
  const userId = await getCurrentUserId();
  const db = await getDb();

  const { data: space, error: spaceError } = await db
    .from("spaces")
    .select("id")
    .eq("id", spaceId)
    .eq("user_id", userId)
    .single();

  if (spaceError || !space) {
    throw new Error("Space not found");
  }

  const { data, error } = await db
    .from("projects")
    .insert({
      space_id: spaceId,
      user_id: userId,
      name,
      description: description ?? null,
      learning_goal: learningGoal ?? null,
    })
    .select()
    .single();

  if (error) throw new Error(error.message);

  await emitLearningEvent({
    userId,
    spaceId,
    projectId: data.id,
    eventType: "PROJECT_CREATED",
    entityType: "project",
    entityId: data.id,
    metadata: { name, space_id: spaceId },
  });

  return data;
}

export async function listProjects(spaceId: string) {
  const userId = await getCurrentUserId();
  const db = await getDb();

  const { data: space, error: spaceError } = await db
    .from("spaces")
    .select("id")
    .eq("id", spaceId)
    .eq("user_id", userId)
    .single();

  if (spaceError || !space) {
    throw new Error("Space not found");
  }

  const { data, error } = await db
    .from("projects")
    .select("*")
    .eq("space_id", spaceId)
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function getProject(projectId: string) {
  const userId = await getCurrentUserId();
  const db = await getDb();

  const { data, error } = await db
    .from("projects")
    .select("*")
    .eq("id", projectId)
    .eq("user_id", userId)
    .single();

  if (error) {
    if (error.code === "PGRST116") return null;
    throw new Error(error.message);
  }
  return data;
}

export async function updateProject(
  projectId: string,
  updates: { name?: string; description?: string; learning_goal?: string }
) {
  const userId = await getCurrentUserId();
  const db = await getDb();

  const { data, error } = await db
    .from("projects")
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq("id", projectId)
    .eq("user_id", userId)
    .select()
    .single();

  if (error) throw new Error(error.message);
  return data;
}

export async function deleteProject(projectId: string) {
  const userId = await getCurrentUserId();
  const db = await getDb();

  const { error } = await db
    .from("projects")
    .delete()
    .eq("id", projectId)
    .eq("user_id", userId);

  if (error) throw new Error(error.message);
}

async function emitLearningEvent(params: {
  userId: string;
  spaceId?: string;
  projectId?: string;
  eventType: string;
  entityType: string;
  entityId: string;
  metadata?: Record<string, unknown>;
}) {
  const db = await getDb();

  const { error } = await db.from("learning_events").insert({
    user_id: params.userId,
    space_id: params.spaceId ?? null,
    project_id: params.projectId ?? null,
    event_type: params.eventType,
    entity_type: params.entityType,
    entity_id: params.entityId,
    metadata: params.metadata ?? null,
  });

  if (error) {
    console.error("Failed to emit learning event:", error);
  }
}