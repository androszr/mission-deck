export const views = {
  'fixture-mod-main': {
    init() {},
    render(subPath, opts) {
      const root = document.getElementById('fixture-mod-main-root');
      if (root) root.textContent = 'fixture loaded';
    }
  }
};
