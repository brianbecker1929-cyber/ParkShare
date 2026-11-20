// Match the image's actual CSS box, including the mobile 220px card.
// Shared by the rendered page and its route-specific responsive preload.
export const HOME_HERO_IMAGE = {
  src: '/home-hero/welcome-768.webp',
  srcSet: [320, 480, 768, 1122].map(width => `/home-hero/welcome-${width}.webp ${width}w`).join(', '),
  sizes: '(max-width: 820px) 220px, 380px',
  width: 1122,
  height: 1402,
};
export const HOME_HERO_AVIF_SRC_SET = [320, 480, 768, 1122]
  .map(width => `/home-hero/welcome-${width}.avif ${width}w`).join(', ');
