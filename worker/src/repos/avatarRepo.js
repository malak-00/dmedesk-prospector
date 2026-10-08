// Profile pictures (sql/037): one small image per person, uploaded by an admin in Controls.
// Before that file is run there is no table: everyone then simply shows their initials.
import { cleanAvatarImage } from "../lib/buddy.js";

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

const missingTable = (error) => Boolean(error) && (error.code === "42P01" || error.code === "PGRST205" || /user_avatars/.test(error.message || ""));

async function activeUsers(supabase) {
  let res = await supabase.from("app_users").select("id, username, display_name, disabled_at").order("display_name");
  if (res.error) res = await supabase.from("app_users").select("id, username, display_name").order("display_name"); // before sql/026
  if (res.error) throw httpError(500, "Failed to load people: " + res.error.message);
  return (res.data || []).filter((u) => !u.disabled_at);
}

// Everyone active, with their picture if they have one (image is null otherwise).
export async function listAvatars(supabase) {
  const [users, pics] = await Promise.all([activeUsers(supabase), supabase.from("user_avatars").select("user_id, image").limit(500)]);
  const images = new Map(pics.error ? [] : (pics.data || []).map((p) => [p.user_id, p.image || null]));
  return {
    avatars: users.map((u) => ({ userId: u.id, username: u.username, name: u.display_name, image: images.get(u.id) || null })),
    unavailable: Boolean(pics.error && missingTable(pics.error)),
  };
}

// Set (or, with an empty image, remove) one person's picture. Admin only; the row is kept either way.
export async function setAvatar(supabase, session, input) {
  const userId = String(input?.userId ?? "").trim();
  if (!userId) throw httpError(400, "Choose a person");
  const image = cleanAvatarImage(input?.image);
  const person = await supabase.from("app_users").select("id").eq("id", userId).maybeSingle();
  if (person.error || !person.data) throw httpError(400, "That person wasn't found");
  const { error } = await supabase.from("user_avatars").upsert({ user_id: userId, image, updated_at: new Date().toISOString(), updated_by: session.id }, { onConflict: "user_id" });
  if (error) throw httpError(missingTable(error) ? 503 : 500, missingTable(error) ? "Run sql/037_user_avatars.sql in Supabase first, then try again" : "Failed to save the picture: " + error.message);
  return { userId, hasImage: Boolean(image) };
}
