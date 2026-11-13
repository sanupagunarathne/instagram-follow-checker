import { describe, expect, it } from "vitest";
import { readExportSelection } from "../../src/lib/files.js";
import { mergeImports, compareAccounts } from "../../src/lib/instagram.js";
const row = (value) => ({
  title: "",
  media_list_data: [],
  string_list_data: [{ value }],
});
const file = (name, data) => ({
  name,
  size: 100,
  text: async () => JSON.stringify(data),
});
const following = {
  relationships_following: [
    { title: "alice", string_list_data: [{ href: "ignored", timestamp: 1 }] },
    { title: "bob" },
  ],
};

describe("automatic export selection", () => {
  it("detects separate and split files regardless of selection order", async () => {
    const result = await readExportSelection([
      file("following.json", following),
      file("followers_1.json", [row("alice")]),
      file("followers_2.json", [row("ALICE"), row("david")]),
    ]);
    expect(mergeImports(result.followers).accounts.map((a) => a.key)).toEqual([
      "alice",
      "david",
    ]);
    expect(mergeImports(result.followers).duplicates).toBe(1);
    expect(
      compareAccounts(
        mergeImports(result.followers).accounts,
        mergeImports(result.following).accounts,
      ).notFollowingBack.map((a) => a.key),
    ).toEqual(["bob"]);
  });
  it("supports both canonical relationship wrappers in a single file", async () => {
    const result = await readExportSelection([
      file("combined.json", {
        relationships_followers: [row("alice")],
        ...following,
      }),
    ]);
    expect(result.followers[0].accounts[0].key).toBe("alice");
    expect(result.following[0].accounts).toHaveLength(2);
  });
  it("supports explicitly empty lists in one combined file", async () => {
    const result = await readExportSelection([
      file("combined.json", {
        relationships_followers: [],
        relationships_following: [],
      }),
    ]);
    expect(result.followers[0].accounts).toEqual([]);
    expect(result.following[0].accounts).toEqual([]);
  });
  it("reports known activity files as ignored without treating them as relationships", async () => {
    const result = await readExportSelection([
      file("followers_1.json", []),
      file("following.json", following),
      file("close_friends.json", [{ timestamp: 1, label_values: [] }]),
      file("pending_follow_requests.json", []),
    ]);
    expect(result.ignored).toEqual([
      "close_friends.json",
      "pending_follow_requests.json",
    ]);
    expect(result.followers[0].accounts).toEqual([]);
  });
  it("does not mistake unrelated files or unknown arrays for followers", async () => {
    await expect(
      readExportSelection([file("close_friends.json", [])]),
    ).rejects.toThrow("Missing followers");
    await expect(
      readExportSelection([file("unknown.json", [row("alice")])]),
    ).rejects.toThrow("Unsupported");
    await expect(
      readExportSelection([
        file("followers_1.json", [{ label_values: [] }]),
        file("following.json", following),
      ]),
    ).rejects.toThrow("Unsupported");
  });
  it.each([
    "restricted_profiles.json",
    "hide_story_from.json",
    "blocked_profiles.json",
  ])(
    "ignores %s without adding its accounts to the comparison",
    async (name) => {
      const result = await readExportSelection([
        file("followers_1.json", [row("alice")]),
        file("following.json", following),
        file(name, [row("bob"), row("not_a_follower")]),
      ]);
      expect(result.ignored).toEqual([name]);
      expect(
        mergeImports(result.followers).accounts.map((account) => account.key),
      ).toEqual(["alice"]);
      expect(
        compareAccounts(
          mergeImports(result.followers).accounts,
          mergeImports(result.following).accounts,
        ).notFollowingBack.map((account) => account.key),
      ).toEqual(["bob"]);
    },
  );
  it("requires both relationship lists even when all three privacy exports are selected", async () => {
    const privacyFiles = [
      "restricted_profiles.json",
      "hide_story_from.json",
      "blocked_profiles.json",
    ].map((name) => file(name, []));
    await expect(readExportSelection(privacyFiles)).rejects.toThrow(
      "Missing followers",
    );
    await expect(
      readExportSelection([file("followers_1.json", []), ...privacyFiles]),
    ).rejects.toThrow("Missing following");
  });
  it("blocks incomplete selections and multiple following snapshots", async () => {
    await expect(
      readExportSelection([file("followers_1.json", [])]),
    ).rejects.toThrow("Missing following");
    await expect(
      readExportSelection([file("following.json", following)]),
    ).rejects.toThrow("Missing followers");
    await expect(
      readExportSelection([
        file("followers_1.json", []),
        file("one.json", following),
        file("two.json", following),
      ]),
    ).rejects.toThrow("Multiple following");
  });
  it("rejects a malformed split file or half of a combined file atomically", async () => {
    await expect(
      readExportSelection([
        file("followers_1.json", []),
        file("followers_2.json", {}),
        file("following.json", following),
      ]),
    ).rejects.toThrow("followers_2.json");
    await expect(
      readExportSelection([
        file("combined.json", {
          relationships_followers: [],
          relationships_following: null,
        }),
      ]),
    ).rejects.toThrow("must be an array");
    await expect(
      readExportSelection([
        { name: "broken.json", size: 1, text: async () => "{broken" },
      ]),
    ).rejects.toThrow("not valid JSON");
  });
  it("enforces missing-input, file-count, size, and format limits", async () => {
    await expect(readExportSelection([])).rejects.toThrow("Choose");
    await expect(
      readExportSelection(Array.from({ length: 51 }, () => file("x.json", []))),
    ).rejects.toThrow("at most 50");
    await expect(
      readExportSelection([{ ...file("x.json", []), size: 101 * 1024 * 1024 }]),
    ).rejects.toThrow("100 MB");
    await expect(
      readExportSelection([{ ...file("x.json", []), size: 26 * 1024 * 1024 }]),
    ).rejects.toThrow("25 MB");
    await expect(readExportSelection([file("export.zip", [])])).rejects.toThrow(
      "JSON files",
    );
  });
});
