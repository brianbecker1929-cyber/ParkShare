import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import sharp from "sharp";

const templates = ["_host-booking", "_parking-confirmation", "_extension-confirmed", "_reminder-halfway", "_reminder-ending"];

test("all five booking emails have deployable, transparent amber-and-white title artwork and accessible title text", async () => {
  const titles = new Set();
  for (const template of templates) {
    const { default: html } = await import(`../api/emails/templates/${template}.template.js`);
    const match = html.match(/class="ps-header-title-image[^\"]*" src="https:\/\/www\.myparkshare\.ca(\/email\/headers\/[^\"]+\.png)" width="(\d+)" alt="([^\"]+)"/);
    assert.ok(match, `${template} must reference deployable artwork with a complete title`);
    assert.ok(match[3].length > 10);
    titles.add(match[3]);
    const file = await readFile(new URL(`../public${match[1]}`, import.meta.url));
    const metadata = await sharp(file).metadata();
    assert.equal(metadata.format, "png");
    assert.equal(metadata.hasAlpha, true);
    assert.equal(metadata.width, Number(match[2]) * 3, "title artwork should remain sharp on high-density displays");
    const { data } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    let amber = 0, white = 0, transparent = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] === 0) transparent++;
      if (data[i] === 255 && data[i + 1] === 193 && data[i + 2] === 7 && data[i + 3] === 255) amber++;
      if (data[i] === 255 && data[i + 1] === 255 && data[i + 2] === 255 && data[i + 3] === 255) white++;
    }
    assert.ok(amber > 100 && white > 100 && transparent > 100, `${template} must contain visible amber and white lettering without a background frame`);
    assert.match(html, /class="ps-header-divider"/);
    assert.doesNotMatch(html, /ps-header-title-frame|ps-header-title-inner|[;"]transform:/);
  }
  assert.equal(titles.size, 5, "each notification keeps its distinct title");
});
