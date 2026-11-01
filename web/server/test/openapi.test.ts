// The API reference (docs/api/openapi.json) is generated from the routes (openapi.ts):
// it must match them, so a route added or changed without `bun run openapi` fails
// here; and it must say what the server enforces about sessions and admins.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { OPENAPI_FILE, openApiDocument } from "../src/openapi";

test("docs/api/openapi.json matches the routes the app mounts", () => {
  const committed = JSON.parse(readFileSync(OPENAPI_FILE, "utf8"));
  if (!Bun.deepEquals(committed, openApiDocument())) {
    throw new Error("docs/api/openapi.json is out of date: run `bun run openapi` in web/server and commit the file");
  }
});

test("it marks public, member and admin routes as the server treats them", () => {
  const paths = openApiDocument().paths as Record<string, Record<string, any>>;
  expect(paths["/api/login"].post).toMatchObject({ security: [], summary: expect.any(String) });
  expect(paths["/api/analyses"].post.security).toEqual([{ session: [] }, { basic: [] }]);
  expect(paths["/api/analyses"].post.requestBody.content["application/json"].schema.required).toContain("ticker");
  expect(paths["/api/analyses/{id}"].get.parameters).toEqual([{ name: "id", in: "path", required: true, schema: { type: "string" } }]);
  expect(paths["/api/admin/errors"].get["x-admin"]).toBe(true);
  expect(paths["/api/me"].get["x-admin"]).toBeUndefined();
  expect(paths["/metrics"].get.security).toEqual([{ metrics: [] }]);
});
