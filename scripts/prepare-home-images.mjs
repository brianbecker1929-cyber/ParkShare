// Recreate the checked-in homepage exports from the approved source artwork.
import sharp from 'sharp';
import {mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';

const source = fileURLToPath(new URL('../public/william-parker-v2/web/1122px/ParkShare_William_Parker_01_Joint_Greeting_Wave-1122.webp', import.meta.url));
const directory = new URL('../public/home-hero/', import.meta.url);
await mkdir(directory, {recursive: true});
for (const width of [320, 480, 768, 1122]) {
  await sharp(source).resize({width}).webp({quality: 68, alphaQuality: 90, effort: 6})
    .toFile(fileURLToPath(new URL(`welcome-${width}.webp`, directory)));
  await sharp(source).resize({width}).avif({quality: 50, effort: 6})
    .toFile(fileURLToPath(new URL(`welcome-${width}.avif`, directory)));
}

// Footer assets must not compete with the hero at their original export sizes.
const brand = fileURLToPath(new URL('../public/brand/parkshare-william-parker-logo.webp', import.meta.url));
for (const width of [480, 960]) {
  await sharp(brand).resize({width}).webp({quality: 80, alphaQuality: 100, effort: 6})
    .toFile(fileURLToPath(new URL(`../public/brand/parkshare-footer-${width}.webp`, import.meta.url)));
}
await sharp(fileURLToPath(new URL('../public/parker/parker-eska-logo.png', import.meta.url)))
  .webp({quality: 80, alphaQuality: 100, effort: 6})
  .toFile(fileURLToPath(new URL('../public/brand/eska-footer.webp', import.meta.url)));
