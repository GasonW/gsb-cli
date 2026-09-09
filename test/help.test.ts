import { strict as assert } from "node:assert";
import { test } from "node:test";

import { HELP_TEXT } from "../src/help.js";

test("help routes report evidence rendering to shared platform components", () => {
  assert.match(HELP_TEXT, /报告 HTML 由 gsb-analysis 生成/);
  assert.match(HELP_TEXT, /复用共享 Trace 与商品卡证据组件/);
});
