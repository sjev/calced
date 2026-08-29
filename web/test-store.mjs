#!/usr/bin/env node
// Storage and share-link tests. No DOM, no localStorage: store.js uses its memory backend.
import assert from "node:assert";
import * as store from "./store.js";
import { compressText, decompressText } from "./share.js";

store.writeFile("budget", "1 + 1");
store.writeFile("alpha", "2 * 2");
assert.deepStrictEqual(store.listFiles(), ["alpha", "budget"]);
assert.strictEqual(store.readFile("budget"), "1 + 1");
assert.strictEqual(store.readFile("missing"), null);

assert.strictEqual(store.renameFile("budget", "alpha"), false);
assert.strictEqual(store.renameFile("budget", "costs"), true);
assert.strictEqual(store.readFile("budget"), null);
assert.strictEqual(store.readFile("costs"), "1 + 1");

assert.strictEqual(store.uniqueName("alpha"), "alpha 2");
assert.strictEqual(store.uniqueName("fresh"), "fresh");

store.setActive("costs");
store.saveActive("3 + 3");
assert.strictEqual(store.readFile("costs"), "3 + 3");
assert.deepStrictEqual(store.getActive(), { name: "costs", text: "3 + 3" });

store.setActive(null);
store.saveActive("draft text");
assert.deepStrictEqual(store.getActive(), { name: null, text: "draft text" });
assert.strictEqual(store.readFile("costs"), "3 + 3");

store.setActive("costs");
store.deleteFile("costs");
assert.deepStrictEqual(store.getActive(), { name: null, text: "draft text" });

const doc = "# Budget\n\nrent 1500\nsum()\n\n5 km in miles\n";
assert.strictEqual(await decompressText(await compressText(doc)), doc);

console.log("store/share tests passed");
