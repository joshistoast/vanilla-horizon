import { Component } from '@theme/component';
import { sectionRenderer } from '@theme/section-renderer';
import { requestIdleCallback, viewTransition } from '@theme/utilities';
import { ThemeEvents } from '@theme/events';

/**
 * A custom element that renders a paginated list of items.
 *
 * @typedef {object} Refs
 * @property {HTMLUListElement} [grid] - The grid element.
 * @property {HTMLSpanElement} [viewMorePrevious] - The view more previous button.
 * @property {HTMLSpanElement} [viewMoreNext] - The view more next button.
 * @property {HTMLElement[]} [cards] - The cards elements.
 *
 * @extends Component<Refs>
 */
export default class PaginatedList extends Component {
  /**
   * @type {Map<number, string>}
   */
  pages = new Map();

  /** @type {IntersectionObserver | undefined} */
  infinityScrollObserver;

  /** @type {((value: void) => void) | null} */
  #resolveNextPagePromise = null;

  /** @type {((value: void) => void) | null} */
  #resolvePreviousPagePromise = null;

  /** @type {string | null} */
  #imageRatioSetting = null;

  connectedCallback() {
    super.connectedCallback();

    this.#storeImageRatioSettings();

    this.#fetchPage('next');
    this.#fetchPage('previous');
    this.#observeViewMore();

    // Listen for filter updates to clear cached pages
    document.addEventListener(ThemeEvents.FilterUpdate, this.#handleFilterUpdate);
  }

  /**
   * Store the image ratio from the first product card for later use
   */
  #storeImageRatioSettings() {
    const firstCardGallery = this.querySelector('[ref="cardGallery"]');
    if (!firstCardGallery) return;

    this.#imageRatioSetting = firstCardGallery.getAttribute('data-image-ratio');
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this.infinityScrollObserver) {
      this.infinityScrollObserver.disconnect();
    }
    // Remove the filter update listener
    document.removeEventListener(ThemeEvents.FilterUpdate, this.#handleFilterUpdate);
  }

  #observeViewMore() {
    const { viewMorePrevious, viewMoreNext } = this.refs;

    if (!viewMorePrevious || !viewMoreNext) return;

    this.infinityScrollObserver = new IntersectionObserver(
      async (entries) => {
        // Wait for any in-progress view transitions to finish
        if (viewTransition.current) await viewTransition.current;

        for (const entry of entries) {
          if (entry.isIntersecting) {
            if (entry.target === viewMorePrevious) {
              this.#renderPreviousPage();
            } else {
              this.#renderNextPage();
            }
          }
        }
      },
      {
        rootMargin: '100px',
      }
    );

    this.infinityScrollObserver.observe(viewMorePrevious);
    this.infinityScrollObserver.observe(viewMoreNext);
  }

  /**
   * @param {Object} pageInfo - The page info
   * @param {number} pageInfo.page - The page number
   * @returns {boolean} Whether to use the page
   */
  #shouldUsePage(pageInfo) {
    if (!pageInfo) return false;
    if (pageInfo.page < 1) return false;

    return true;
  }

  /**
   * @param {"previous" | "next"} type
   */
  async #fetchPage(type) {
    const page = this.#getPage(type);

    if (!page || !this.#shouldUsePage(page)) return;

    await this.#fetchSpecificPage(page.page, page.url);

    if (type === 'next') {
      this.#resolveNextPagePromise?.();
      this.#resolveNextPagePromise = null;
    } else {
      this.#resolvePreviousPagePromise?.();
      this.#resolvePreviousPagePromise = null;
    }
  }

  /**
   * @param {number} pageNumber - The page number to fetch
   * @param {URL} [url] - Optional URL, will be constructed if not provided
   */
  async #fetchSpecificPage(pageNumber, url = undefined) {
    const pageInfo = { page: pageNumber, url };

    if (!url) {
      const newUrl = new URL(window.location.href);
      newUrl.searchParams.set('page', pageNumber.toString());
      newUrl.hash = '';
      pageInfo.url = newUrl;
    }

    if (!this.#shouldUsePage(pageInfo)) return;
    const pageContent = await sectionRenderer.getSectionHTML(this.sectionId, true, pageInfo.url);
    this.pages.set(pageNumber, pageContent);
  }

  async #renderNextPage() {
    const { grid } = this.refs;

    if (!grid) return;

    const nextPage = this.#getPage('next');
    if (!nextPage || !this.#shouldUsePage(nextPage)) return;
    let nextPageItemElements = this.#getGridForPage(nextPage.page);

    if (!nextPageItemElements) {
      const promise = new Promise((res) => {
        this.#resolveNextPagePromise = res;
      });
      await promise;
      nextPageItemElements = this.#getGridForPage(nextPage.page);
      if (!nextPageItemElements) return;
    }

    grid.append(...nextPageItemElements);

    this.#processNewElements();

    history.pushState('', '', nextPage.url.toString());

    requestIdleCallback(() => {
      this.#fetchPage('next');
    });
  }

  async #renderPreviousPage() {
    const { grid } = this.refs;

    if (!grid) return;

    const previousPage = this.#getPage('previous');
    if (!previousPage || !this.#shouldUsePage(previousPage)) return;

    let previousPageItemElements = this.#getGridForPage(previousPage.page);
    if (!previousPageItemElements) {
      const promise = new Promise((res) => {
        this.#resolvePreviousPagePromise = res;
      });
      await promise;
      previousPageItemElements = this.#getGridForPage(previousPage.page);
      if (!previousPageItemElements) return;
    }

    // Store the current scroll position and height of the first element
    const scrollTop = window.scrollY;
    const firstElement = grid.firstElementChild;
    const oldHeight = firstElement ? firstElement.getBoundingClientRect().top + window.scrollY : 0;

    // Prepend the new elements
    grid.prepend(...previousPageItemElements);

    this.#processNewElements();

    history.pushState('', '', previousPage.url.toString());

    // Calculate and adjust scroll position to maintain the same view
    if (firstElement) {
      const newHeight = firstElement.getBoundingClientRect().top + window.scrollY;
      const heightDiff = newHeight - oldHeight;
      window.scrollTo({
        top: scrollTop + heightDiff,
        behavior: 'instant',
      });
    }

    requestIdleCallback(() => {
      this.#fetchPage('previous');
    });
  }

  /**
   * Process newly added elements and apply correct aspect ratios
   */
  #processNewElements() {
    // Wait for the DOM to update
    requestAnimationFrame(() => {
      this.#imageRatioSetting === 'adapt' ? this.#fixAdaptiveAspectRatios() : this.#applyFixedAspectRatio();
    });
  }

  /**
   * Get all unprocessed card galleries
   * @returns {NodeListOf<Element>} List of unprocessed galleries
   */
  #getUnprocessedGalleries() {
    return this.querySelectorAll('.card-gallery:not([data-aspect-ratio-applied])');
  }

  /**
   * Mark gallery as processed
   * @param {HTMLElement} gallery - The gallery element to mark as processed
   */
  #markAsProcessed(gallery) {
    if (!(gallery instanceof HTMLElement)) return;
    gallery.setAttribute('data-aspect-ratio-applied', 'true');
  }

  /**
   * Calculate a safe aspect ratio value from image dimensions
   * Ensures the ratio stays within reasonable bounds and has consistent decimal places
   * @param {number} width - Natural width of the image
   * @param {number} height - Natural height of the image
   * @returns {string} Normalized aspect ratio as a string
   */
  #getSafeImageAspectRatio(width, height) {
    const rawRatio = width / height;
    return Math.max(0.1, Math.min(10, rawRatio)).toFixed(3);
  }

  /**
   * Apply an aspect ratio to a gallery and all its media containers
   * @param {HTMLElement} gallery - The gallery element
   * @param {string} aspectRatio - The aspect ratio to apply
   */
  #applyAspectRatioToGallery(gallery, aspectRatio) {
    if (!(gallery instanceof HTMLElement)) return;

    gallery.style.setProperty('--gallery-aspect-ratio', aspectRatio);

    const mediaContainers = gallery.querySelectorAll('.product-media-container');
    mediaContainers.forEach((container) => {
      if (container instanceof HTMLElement) {
        container.style.aspectRatio = aspectRatio;
      }
    });

    this.#markAsProcessed(gallery);
  }

  /**
   * Fix adaptive aspect ratios for newly added cards
   * For the 'adapt' setting, each product should use its own image's aspect ratio
   */
  #fixAdaptiveAspectRatios() {
    const newCardGalleries = this.#getUnprocessedGalleries();
    if (!newCardGalleries.length) return;

    const productRatioCache = new Map();

    newCardGalleries.forEach((gallery) => {
      if (!(gallery instanceof HTMLElement)) return;

      const productId = gallery.getAttribute('data-product-id');
      if (productId && productRatioCache.has(productId)) {
        this.#applyAspectRatioToGallery(gallery, productRatioCache.get(productId));
        return;
      }

      const img = gallery.querySelector('img');
      if (!img) {
        this.#applyAspectRatioToGallery(gallery, '1');
        return;
      }

      const loadAndSetRatio = () => {
        if (!img.naturalWidth || !img.naturalHeight) return;

        const imgRatio = this.#getSafeImageAspectRatio(img.naturalWidth, img.naturalHeight);

        if (productId) {
          productRatioCache.set(productId, imgRatio);
        }

        this.#applyAspectRatioToGallery(gallery, imgRatio);
      };

      if (img.complete) {
        loadAndSetRatio();
      } else {
        img.addEventListener('load', loadAndSetRatio, { once: true });
      }
    });
  }

  /**
   * Apply a fixed aspect ratio to all card-gallery and media container elements
   * Only used for non-adaptive modes (square, portrait, landscape)
   */
  #applyFixedAspectRatio() {
    if (!this.#imageRatioSetting) return;

    const aspectRatio = this.#getAspectRatioValue(this.#imageRatioSetting);
    if (!aspectRatio) return;

    const newCardGalleries = this.#getUnprocessedGalleries();
    if (!newCardGalleries.length) return;

    // Batch DOM operations for better performance
    requestAnimationFrame(() => {
      newCardGalleries.forEach((gallery) => {
        if (!(gallery instanceof HTMLElement)) return;
        this.#applyAspectRatioToGallery(gallery, aspectRatio);
      });
    });
  }

  /**
   * Aspect ratio values matching the theme's standardized values
   * @type {Object.<string, string>}
   */
  static ASPECT_RATIOS = {
    square: '1',
    portrait: '0.8',
    landscape: '1.778',
  };

  /**
   * Get aspect ratio value based on setting
   * @param {string} ratioSetting - The ratio setting name
   * @returns {string|null} - The aspect ratio value or null
   */
  #getAspectRatioValue(ratioSetting) {
    return PaginatedList.ASPECT_RATIOS[ratioSetting] || null;
  }

  /**
   * @param {"previous" | "next"} type
   * @returns {{ page: number, url: URL } | undefined}
   */
  #getPage(type) {
    const { cards } = this.refs;
    const isPrevious = type === 'previous';

    if (!Array.isArray(cards)) return;

    const targetCard = cards[isPrevious ? 0 : cards.length - 1];

    if (!targetCard) return;

    const page = isPrevious ? Number(targetCard.dataset.page) - 1 : Number(targetCard.dataset.page) + 1;

    const url = new URL(window.location.href);
    url.searchParams.set('page', page.toString());
    url.hash = '';

    return {
      page,
      url,
    };
  }

  /**
   * @param {number} page
   * @returns {NodeListOf<Element> | undefined}
   */
  #getGridForPage(page) {
    const pageHTML = this.pages.get(page);

    if (!pageHTML) return;

    const parsedPage = new DOMParser().parseFromString(pageHTML, 'text/html');
    const gridElement = parsedPage.querySelector('[ref="grid"]');
    if (!gridElement) return;
    return gridElement.querySelectorAll(':scope > [ref="cards[]"]');
  }

  get sectionId() {
    const id = this.getAttribute('section-id');

    if (!id) throw new Error('The section-id attribute is required');

    return id;
  }

  /**
   * Handle filter updates by clearing cached pages
   */
  #handleFilterUpdate = () => {
    this.pages.clear();

    // Resolve any pending promises to unblock waiting renders
    this.#resolveNextPagePromise?.();
    this.#resolvePreviousPagePromise?.();

    this.#resolveNextPagePromise = null;
    this.#resolvePreviousPagePromise = null;

    // After a filter update, pagination typically resets to page 1
    // Fetch page 2 as the "next" page since page 1 is already visible
    this.#fetchSpecificPage(2);
  };
}
