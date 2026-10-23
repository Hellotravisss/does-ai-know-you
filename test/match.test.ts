import assert from "node:assert/strict";
import { brandTerms, matchBrand, linksToSite } from "../src/match";

const t = brandTerms("甜屑 Sweet Crumb", "https://www.sweetcrumb.com", ["WHSD"]);
assert.deepEqual(t, ["甜屑 Sweet Crumb", "甜屑", "Sweet Crumb", "sweetcrumb.com", "WHSD"]);
assert.equal(matchBrand("推荐本拿比的甜屑，生日蛋糕很好吃", [], t), "甜屑");          // Chinese half alone
assert.equal(matchBrand("Try sweet crumb on Kingsway", [], t), "Sweet Crumb"); // case-insensitive Latin half
assert.equal(matchBrand("Lots of bakeries here", ["https://sweetcrumb.com/cakes"], t), "sweetcrumb.com"); // cited link
assert.equal(matchBrand("Lots of bakeries here", [], t), undefined);
assert.equal(brandTerms("Avowd", "").length, 1);                                           // short Latin names still match whole
assert.ok(linksToSite(["https://www.sweetcrumb.com/about"], "sweetcrumb.com"));
assert.ok(!linksToSite(["https://yelp.com/biz/sweetcrumb"], "sweetcrumb.com"));    // a mention on Yelp is not a link to your site
console.log("match: 8 passed");
