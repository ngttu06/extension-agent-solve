import { defineManifest } from '@crxjs/vite-plugin';

export default defineManifest({
  manifest_version: 3,
  name: 'Agent Solve — Browser AI Agent',
  version: '0.2.0',
  description:
    'An AI agent that perceives, reasons and acts on web pages using configurable AI providers.',
  minimum_chrome_version: '116',
  action: {
    default_title: 'Open Agent Solve',
  },
  background: {
    service_worker: 'src/background/index.ts',
    type: 'module',
  },
  side_panel: {
    default_path: 'src/sidepanel/index.html',
  },
  content_scripts: [
    {
      matches: ['<all_urls>'],
      js: ['src/content/index.ts'],
      run_at: 'document_idle',
      all_frames: false,
    },
  ],
  permissions: ['activeTab', 'debugger', 'scripting', 'storage', 'sidePanel', 'tabs'],
  host_permissions: ['<all_urls>'],
});
