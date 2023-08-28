async function detectSectionType(sectionEl) {
  const hasImg = sectionEl.querySelector('img') !== null;
  const hasText = sectionEl.textContent.replaceAll('\n', '').trim().length > 0;

  if (!hasImg && hasText) {
    return 'text';
  }

  return null;
}
