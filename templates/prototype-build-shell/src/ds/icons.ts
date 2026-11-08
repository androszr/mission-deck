// Icon catalog of the prototype kit. Each adapter name maps to the slug of an
// icon in assets/icons/ds/manifest.json (the one icon source); the build keeps
// the SVG files under public/ds-icons/ and DSIcon paints them with currentColor,
// so an icon takes the text colour of its parent - tint it by setting `color`.
//
// The DS linter reads the keys of ICONS: <DSIcon name="x"> with a name that is
// neither a key here nor a manifest slug is a BLOCK ("unknown icon").

export const ICONS = {
  menu: '24-ic-menu',
  close: '24-ic-close',
  'chevron-right': '24-ic-chevron-right',
  'chevron-left': '24-ic-chevron-left',
  'chevron-down': '24-ic-chevron-bottom',
  'arrow-right': '24-ic-arrow-right',
  search: '16-ic-search',
  filter: '24-ic-filter',
  plus: '16-ic-add',
  check: '16-ic-tick',
  'check-circle': '24-ic-notification-success',
  alert: '24-ic-notification-warning',
  info: '24-ic-notification-information',
  clock: '24-ic-clock',
  calendar: '24-ic-calendar',
  user: '24-ic-user',
  users: '24-ic-users',
  bell: '24-ic-bell',
  home: '24-ic-home',
  list: '24-ic-todo-list-dots',
  'map-pin': '24-ic-map-pin',
  wrench: '24-ic-wrench',
  camera: '24-ic-camera',
  wind: '24-ic-wind',
  turbine: '24-ic-turbine',
  shield: '16-ic-shield',
  message: '24-ic-message',
  more: '24-ic-more',
  play: '24-ic-play',
  pause: '16-ic-pause',
  'volume-on': '24-ic-volume-on',
  'volume-off': '24-ic-volume-off',
  captions: '24-ic-captions',
  bolt: '24-ic-bolt',
  package: '24-ic-package-m',
  route: '24-ic-route',
  'wifi-off': '24-ic-wifi-off',
  gauge: '24-ic-gauge',
} as const;

export type IconName = keyof typeof ICONS;
