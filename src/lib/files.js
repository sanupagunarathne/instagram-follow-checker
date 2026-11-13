import { parseExport } from "./instagram.js";

// Bounds protect the tab from accidentally loading an entire export archive.
export const MAX_FILE_BYTES = 25 * 1024 * 1024;
export const MAX_BATCH_BYTES = 100 * 1024 * 1024;
export const MAX_FILES = 50;

// Only these known non-relationship files may be ignored. Unknown files fail
// explicitly, so a renamed or broken relationship file cannot disappear silently.
const unrelatedFiles = new Set([
  "custom_lists.json",
  "follow_requests_you've_received.json",
  "pending_follow_requests.json",
  "recent_follow_requests.json",
  "recently_unfollowed_profiles.json",
  "close_friends.json",
  "restricted_profiles.json",
  "hide_story_from.json",
  "blocked_profiles.json",
]);

export async function readExportSelection(files) {
  const selected = Array.from(files);
  if (!selected.length)
    throw new Error("Choose your Instagram JSON export files.");
  if (selected.length > MAX_FILES)
    throw new Error(`Choose at most ${MAX_FILES} files at a time.`);
  if (selected.reduce((sum, file) => sum + file.size, 0) > MAX_BATCH_BYTES)
    throw new Error("This selection exceeds 100 MB.");
  const result = { followers: [], following: [], ignored: [] };
  const errors = [];
  for (const file of selected) {
    try {
      if (!/\.json$/i.test(file.name))
        throw new Error("Choose JSON files, not a ZIP or HTML export.");
      if (file.size > MAX_FILE_BYTES)
        throw new Error("File exceeds the 25 MB limit.");
      let data;
      try {
        data = JSON.parse((await file.text()).replace(/^\uFEFF/, ""));
      } catch {
        throw new Error(
          "This file is not valid JSON. Choose the original JSON export.",
        );
      }
      const object =
        data !== null && typeof data === "object" && !Array.isArray(data);
      const hasFollowers =
        object && Object.hasOwn(data, "relationships_followers");
      const hasFollowing =
        object && Object.hasOwn(data, "relationships_following");
      if (hasFollowers || hasFollowing) {
        for (const kind of ["followers", "following"]) {
          const field = `relationships_${kind}`;
          if (Object.hasOwn(data, field))
            result[kind].push({
              ...parseExport({ [field]: data[field] }, kind),
              name: file.name,
            });
        }
      } else if (
        Array.isArray(data) &&
        /^followers(?:_\d+)?\.json$/i.test(file.name)
      ) {
        result.followers.push({
          ...parseExport(data, "followers"),
          name: file.name,
        });
      } else if (unrelatedFiles.has(file.name.toLowerCase())) {
        result.ignored.push(file.name);
      } else {
        throw new Error(
          "Unsupported export structure. Select followers_*.json and following.json together, or a combined file with relationships_followers and relationships_following. Raw followers arrays must retain their followers filename.",
        );
      }
    } catch (error) {
      errors.push(`${file.name}: ${error.message}`);
    }
  }
  if (errors.length) throw new Error(errors.join("\n"));
  for (const kind of ["followers", "following"]) {
    if (!result[kind].length)
      throw new Error(
        `Missing ${kind} data. Select all followers files and following.json together, or one combined relationship JSON file. Activity and privacy-setting files cannot replace these lists.`,
      );
  }
  if (result.following.length > 1)
    throw new Error(
      "Multiple following lists found. Select files from only one export to avoid mixing snapshots.",
    );
  return result;
}
