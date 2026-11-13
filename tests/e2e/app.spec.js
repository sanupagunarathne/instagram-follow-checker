import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { test, expect } from "@playwright/test";
const fixture = (name) =>
  fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url));
const upload = (name, data) => ({
  name,
  mimeType: "application/json",
  buffer: Buffer.from(JSON.stringify(data)),
});
const input = (page) => page.getByLabel("Import Instagram JSON files");
const compare = (page) =>
  page.getByRole("button", { name: "Compare accounts", exact: true });
const rows = (page) => page.locator("tbody tr");
const combined = (followers = [], following = []) =>
  upload("combined.json", {
    relationships_followers: followers,
    relationships_following: following,
  });
const record = (value) => ({ string_list_data: [{ value }] });

test("single upload detects split files; comparisons, search, sorting, CSV and privacy work", async ({
  page,
}) => {
  const external = [],
    errors = [];
  page.on("request", (request) => {
    if (!request.url().startsWith("http://127.0.0.1:4173/"))
      external.push(request.url());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page.locator("input[type=file]")).toHaveCount(1);
  await expect(compare(page)).toBeDisabled();
  await input(page).setInputFiles([
    fixture("following.json"),
    fixture("followers_1.json"),
    fixture("followers_2.json"),
  ]);
  await expect(
    page.getByText("3 unique followers", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("1 duplicate username removed.")).toBeVisible();
  await compare(page).click();
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).first()).toContainText("@bob");
  const link = page.getByRole("link", {
    name: "Open @bob on Instagram (new tab)",
  });
  await expect(link).toHaveAttribute("href", "https://www.instagram.com/bob/");
  await expect(link).toHaveAttribute("rel", "noopener noreferrer");
  await page.getByRole("button", { name: /I do not follow back/ }).click();
  await expect(rows(page).first()).toContainText("@david");
  await page.getByRole("button", { name: /Mutual follows/ }).click();
  await expect(rows(page)).toHaveCount(2);
  await page.getByLabel("Sort usernames").selectOption("desc");
  await expect(rows(page).first()).toContainText("@charlie");
  await page.getByRole("searchbox").fill("@AL");
  await expect(rows(page)).toHaveCount(1);
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export CSV" }).click();
  const csv = await readFile(await (await pending).path(), "utf8");
  expect(csv).toContain('"alice","https://www.instagram.com/alice/"');
  expect(csv).not.toContain("charlie");
  await page.getByRole("searchbox").fill("no_match");
  await expect(page.getByText("No matching usernames")).toBeVisible();
  await expect(page.getByRole("button", { name: "Export CSV" })).toBeDisabled();
  await page.getByRole("button", { name: "Clear all data" }).click();
  await expect(compare(page)).toBeDisabled();
  await expect(
    page.getByRole("heading", { name: "Your connection report" }),
  ).toHaveCount(0);
  expect(
    await page.evaluate(() => ({
      local: localStorage.length,
      session: sessionStorage.length,
      cookies: document.cookie,
    })),
  ).toEqual({ local: 0, session: 0, cookies: "" });
  expect(external).toEqual([]);
  expect(errors).toEqual([]);
});

test("combined file, unrelated activity notice and export guidance below uploader", async ({
  page,
}) => {
  await page.goto("/");
  await input(page).setInputFiles([
    combined([record("alice")], [record("alice"), record("bob")]),
    upload("close_friends.json", [{ label_values: [] }]),
    upload("restricted_profiles.json", [record("bob")]),
    upload("hide_story_from.json", [record("bob")]),
    upload("blocked_profiles.json", [record("bob")]),
  ]);
  await expect(page.locator(".ignored-files")).toContainText(
    "close_friends.json",
  );
  await expect(page.locator(".ignored-files")).toContainText(
    "4 unrelated files ignored",
  );
  for (const name of [
    "restricted_profiles.json",
    "hide_story_from.json",
    "blocked_profiles.json",
  ]) {
    await expect(page.locator(".ignored-files")).toContainText(name);
  }
  await compare(page).click();
  await expect(rows(page).first()).toContainText("@bob");
  const bounds = await page.evaluate(() => ({
    uploader: document.querySelector(".unified-upload").getBoundingClientRect()
      .bottom,
    notice: document.querySelector(".export-notice").getBoundingClientRect()
      .top,
  }));
  expect(bounds.notice).toBeGreaterThan(bounds.uploader);
  await expect(
    page.getByRole("link", {
      name: "Open Instagram Accounts Center (new tab)",
    }),
  ).toHaveAttribute("target", "_blank");
});

test("incomplete or invalid selection removes old results and never mixes with demo", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Try a demo" }).click();
  await input(page).setInputFiles(fixture("followers_1.json"));
  await expect(page.getByRole("alert")).toContainText("Missing following");
  await expect(compare(page)).toBeDisabled();
  await expect(
    page.getByRole("heading", { name: "Your connection report" }),
  ).toHaveCount(0);
  await input(page).setInputFiles([
    fixture("followers_1.json"),
    fixture("following.json"),
  ]);
  await compare(page).click();
  await expect(
    page.getByText("Comparison complete", { exact: true }),
  ).toBeVisible();
  await input(page).setInputFiles([
    combined(),
    upload("unsupported.json", { messages: [] }),
  ]);
  await expect(page.getByRole("alert")).toContainText("Unsupported");
  await expect(compare(page)).toBeDisabled();
  await page.reload();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(compare(page)).toBeDisabled();
});

test("valid empty lists and malformed JSON remain distinct", async ({
  page,
}) => {
  await page.goto("/");
  await input(page).setInputFiles(combined());
  await compare(page).click();
  await expect(page.getByText("No accounts in this category")).toBeVisible();
  await expect(page.getByRole("button", { name: "Export CSV" })).toBeDisabled();
  await input(page).setInputFiles({
    name: "broken.json",
    mimeType: "application/json",
    buffer: Buffer.from("{broken"),
  });
  await expect(page.getByRole("alert")).toContainText("not valid JSON");
  await expect(compare(page)).toBeDisabled();
});

test("new media_list_data schema, title fallback, skipped records and safe links", async ({
  page,
}) => {
  await page.goto("/");
  await input(page).setInputFiles(
    combined(
      [
        {
          title: "",
          media_list_data: [],
          string_list_data: [{ value: "alice", href: "https://evil.example" }],
        },
        record("<script>"),
        { label_values: [] },
      ],
      [
        {
          title: "alice",
          string_list_data: [{ href: "ignored", timestamp: 1 }],
        },
      ],
    ),
  );
  await expect(
    page.getByText(/2 skipped records · 1 invalid username entries/),
  ).toBeVisible();
  await page.getByText("Review files and skipped records").click();
  await expect(page.getByText(/Record 2: Skipped an invalid/)).toBeVisible();
  await compare(page).click();
  await page.getByRole("button", { name: /Mutual follows/ }).click();
  await expect(rows(page)).toHaveCount(1);
  await expect(
    page.getByRole("link", { name: "Open @alice on Instagram (new tab)" }),
  ).toHaveAttribute("href", "https://www.instagram.com/alice/");
});

test("pagination limits rows but CSV includes all filtered results", async ({
  page,
}) => {
  await page.goto("/");
  await input(page).setInputFiles(
    combined(
      [],
      Array.from({ length: 123 }, (_, i) =>
        record(`demo_${String(i).padStart(3, "0")}`),
      ),
    ),
  );
  await compare(page).click();
  await expect(rows(page)).toHaveCount(50);
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(rows(page).first()).toContainText("@demo_050");
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export CSV" }).click();
  expect(
    (await readFile(await (await pending).path(), "utf8")).trim().split("\r\n"),
  ).toHaveLength(124);
  await page.getByRole("searchbox").fill("demo_12");
  await expect(rows(page)).toHaveCount(3);
});

test("clear cancels stale imports and mobile has no horizontal overflow", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const original = File.prototype.text;
    File.prototype.text = async function () {
      await new Promise((resolve) => {
        window.releaseFileRead = resolve;
      });
      return original.call(this);
    };
  });
  await page.goto("/");
  await input(page).setInputFiles(combined());
  await expect(page.getByText("Reading files locally…")).toBeVisible();
  await page.getByRole("button", { name: "Clear all data" }).click();
  await page.evaluate(async () => {
    window.releaseFileRead();
    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve)),
    );
  });
  await expect(compare(page)).toBeDisabled();
  await page.getByRole("button", { name: "Try a demo" }).click();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: `test-results/unified-${test.info().project.name}.png`,
    fullPage: true,
  });
});

test("reloading demo resets filters", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Try a demo" }).click();
  await page.getByRole("searchbox").fill("no_match");
  await page.getByRole("button", { name: "Try a demo" }).click();
  await expect(page.getByRole("searchbox")).toHaveValue("");
  await expect(rows(page).first()).toContainText("@bob");
});
