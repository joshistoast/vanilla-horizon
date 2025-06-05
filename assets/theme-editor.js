// Theme editor specific logic

/**
 * @param {Event} event
 */
document.addEventListener('shopify:block:select', function (event) {
  if (event.target instanceof HTMLElement) {
    const slide = event.target.closest('slideshow-slide');

    if (slide) {
      /** @type {import('./slideshow').Slideshow | null} */
      const slideshow = slide.closest('slideshow-component');

      if (slideshow) {
        const index = Array.from(slide.parentElement?.children ?? []).indexOf(slide);

        if (index !== -1) {
          // Pause autoplay
          slideshow.pause();
          slideshow.select(index);
        }
      }
    }
  }
});

document.addEventListener('shopify:block:deselect', function (event) {
  if (event.target instanceof HTMLElement) {
    /** @type {import('./slideshow').Slideshow | null} */
    const slideshow = event.target.closest('slideshow-component');

    if (slideshow) {
      // Resume playback
      slideshow.resume();
    }
  }
});
