export const views = {
  'fixture-hub-lista': {
    init() {},
    render(subPath, opts) {
      const root = document.getElementById('fixture-hub-lista-root');
      if (root) root.textContent = 'fixture hub lista loaded';
    }
  },
  'fixture-hub-raport': {
    init() {},
    render(subPath, opts) {
      const root = document.getElementById('fixture-hub-raport-root');
      if (root) root.textContent = 'fixture hub raport loaded';
    }
  }
};
