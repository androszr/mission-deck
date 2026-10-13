// Fixture widget: present so the manifest's client path exists on disk.
export async function renderWidget(el) {
  el.textContent = 'fixture';
  return () => {};
}
