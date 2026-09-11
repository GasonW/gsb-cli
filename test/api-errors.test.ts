import { test } from "node:test";
import * as assert from "node:assert/strict";
import { serverError } from "../src/api.js";

test("structured errors preserve message and code", () => {
  assert.equal(serverError({error: {code: "FORBIDDEN", message: "Forbidden"}}), "Forbidden (FORBIDDEN)");
  assert.equal(serverError({error: {message: ["score required", "query required"]}}), "score required；query required");
  assert.equal(serverError({error: {message: {nested: true}}}), "请求失败");
  assert.equal(serverError({error: "legacy error"}), "legacy error");
  assert.match(serverError({error: {code: "FORBIDDEN", message: "csrf token missing"}}), /csrf/);
});
