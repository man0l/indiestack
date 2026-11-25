// Lucide icon bodies (ISC, https://lucide.dev) for the server-rendered admin nav.
// Keyed by plugin id; rendered inside a 24x24 stroke svg by navIcon().
export const NAV_ICONS: Record<string, string> = {
  overview: `<rect width='7' height='9' x='3' y='3' rx='1'/><rect width='7' height='5' x='14' y='3' rx='1'/><rect width='7' height='9' x='14' y='12' rx='1'/><rect width='7' height='5' x='3' y='16' rx='1'/>`,
  ping: `<path d='M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2'/>`,
  heartbeat: `<path d='M2 9.5a5.5 5.5 0 0 1 9.591-3.676.56.56 0 0 0 .818 0A5.49 5.49 0 0 1 22 9.5c0 2.29-1.5 4-3 5.5l-5.492 5.313a2 2 0 0 1-3 .019L5 15c-1.5-1.5-3-3.2-3-5.5'/><path d='M3.22 13H9.5l.5-1 2 4.5 2-7 1.5 3.5h5.27'/>`,
  integrations: `<path d='M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5'/><path d='M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09'/><path d='M9 12a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.4 22.4 0 0 1-4 2z'/><path d='M9 12H4s.55-3.03 2-4c1.62-1.08 5 .05 5 .05'/>`,
  logs: `<path d='M15 12h-5'/><path d='M15 8h-5'/><path d='M19 17V5a2 2 0 0 0-2-2H4'/><path d='M8 21h12a2 2 0 0 0 2-2v-1a1 1 0 0 0-1-1H11a1 1 0 0 0-1 1v1a2 2 0 1 1-4 0V5a2 2 0 1 0-4 0v2a1 1 0 0 0 1 1h3'/>`,
  templates: `<rect width='18' height='7' x='3' y='3' rx='1'/><rect width='9' height='7' x='3' y='14' rx='1'/><rect width='5' height='7' x='16' y='14' rx='1'/>`,
  analytics: `<path d='M3 3v16a2 2 0 0 0 2 2h16'/><path d='M18 17V9'/><path d='M13 17V5'/><path d='M8 17v-3'/>`,
  goals: `<circle cx='12' cy='12' r='10'/><circle cx='12' cy='12' r='6'/><circle cx='12' cy='12' r='2'/>`,
  signals: `<path d='M16.247 7.761a6 6 0 0 1 0 8.478'/><path d='M19.075 4.933a10 10 0 0 1 0 14.134'/><path d='M4.925 19.067a10 10 0 0 1 0-14.134'/><path d='M7.753 16.239a6 6 0 0 1 0-8.478'/><circle cx='12' cy='12' r='2'/>`,
  aicrawl: `<path d='M12 8V4H8'/><rect width='16' height='12' x='4' y='8' rx='2'/><path d='M2 14h2'/><path d='M20 14h2'/><path d='M15 13v2'/><path d='M9 13v2'/>`,
  revenue: `<circle cx='12' cy='12' r='10'/><path d='M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8'/><path d='M12 18V6'/>`,
  appstore: `<rect width='14' height='20' x='5' y='2' rx='2' ry='2'/><path d='M12 18h.01'/>`,
  slashloop: `<path d='m2 9 3-3 3 3'/><path d='M13 18H7a2 2 0 0 1-2-2V6'/><path d='m22 15-3 3-3-3'/><path d='M11 6h6a2 2 0 0 1 2 2v10'/>`,
  agents: `<path d='M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z'/><path d='M20 2v4'/><path d='M22 4h-4'/><circle cx='4' cy='20' r='2'/>`,
  widgets: `<path d='M15.39 4.39a1 1 0 0 0 1.68-.474 2.5 2.5 0 1 1 3.014 3.015 1 1 0 0 0-.474 1.68l1.683 1.682a2.414 2.414 0 0 1 0 3.414L19.61 15.39a1 1 0 0 1-1.68-.474 2.5 2.5 0 1 0-3.014 3.015 1 1 0 0 1 .474 1.68l-1.683 1.682a2.414 2.414 0 0 1-3.414 0L8.61 19.61a1 1 0 0 0-1.68.474 2.5 2.5 0 1 1-3.014-3.015 1 1 0 0 0 .474-1.68l-1.683-1.682a2.414 2.414 0 0 1 0-3.414L4.39 8.61a1 1 0 0 1 1.68.474 2.5 2.5 0 1 0 3.014-3.015 1 1 0 0 1-.474-1.68l1.683-1.682a2.414 2.414 0 0 1 3.414 0z'/>`,
  share: `<circle cx='18' cy='5' r='3'/><circle cx='6' cy='12' r='3'/><circle cx='18' cy='19' r='3'/><line x1='8.59' x2='15.42' y1='13.51' y2='17.49'/><line x1='15.41' x2='8.59' y1='6.51' y2='10.49'/>`,
  backup: `<rect width='20' height='5' x='2' y='3' rx='1'/><path d='M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8'/><path d='M10 12h4'/>`,
  settings: `<path d='M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915'/><circle cx='12' cy='12' r='3'/>`,
  explorer: `<circle cx='12' cy='12' r='10'/><path d='m16.24 7.76-1.804 5.411a2 2 0 0 1-1.265 1.265L7.76 16.24l1.804-5.411a2 2 0 0 1 1.265-1.265z'/>`,
  status: `<circle cx='12' cy='12' r='10'/><path d='M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20'/><path d='M2 12h20'/>`,
  agentsmd: `<path d='M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z'/><path d='M14 2v5a1 1 0 0 0 1 1h5'/><path d='M10 9H8'/><path d='M16 13H8'/><path d='M16 17H8'/>`,
  logout: `<path d='m16 17 5-5-5-5'/><path d='M21 12H9'/><path d='M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4'/>`,
  dot: `<circle cx='12' cy='12' r='10'/>`,
};

export function navIcon(id: string): string {
  return `<svg class="sico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${NAV_ICONS[id] ?? NAV_ICONS.dot}</svg>`;
}
