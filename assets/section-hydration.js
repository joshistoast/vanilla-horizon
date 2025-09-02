import { buildSectionSelector, normalizeSectionId, sectionRenderer } from '@theme/section-renderer';
import { requestIdleCallback, onDocumentReady } from '@theme/utilities';

/**
 * Hydrates a section using the Section Rendering API preserving states.
 * Only updates elements with data-lazy-hydration attribute.
 *
 * @param {string} sectionId - The section ID to hydrate
 */
async function hydrateSection(sectionId) {
  const normalizedId = normalizeSectionId(sectionId);
  const section = document.getElementById(buildSectionSelector(normalizedId));

  if (!section || section.dataset.hydrated === 'true') {
    return;
  }

  await sectionRenderer.renderSection(normalizedId, { cache: false });

  section.dataset.hydrated = 'true';
}

/**
 * Hydrates a section using the Section Rendering API preserving states, when
 * the DOM is ready.
 *
 * @param {string} sectionId - The section ID to hydrate
 */
export async function hydrate(sectionId) {
  onDocumentReady(() => {
    requestIdleCallback(() => hydrateSection(sectionId));
  });
}
