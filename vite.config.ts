import { defineConfig, type Plugin } from 'vite';

// Chrome refuses to load external module scripts over file://, so the build
// inlines the bundle into index.html and dist/ opens with a double-click.
function inlineBundle(): Plugin {
  return {
    name: 'inline-bundle',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        const bundle = ctx.bundle;
        if (!bundle) return html;
        return html.replace(
          /<script type="module" crossorigin src="\.\/([^"]+)"><\/script>/g,
          (tag, fileName: string) => {
            const chunk = bundle[fileName];
            if (!chunk || chunk.type !== 'chunk') return tag;
            delete bundle[fileName];
            return `<script type="module">${chunk.code.replaceAll('</script', '<\\/script')}</script>`;
          },
        );
      },
    },
  };
}

export default defineConfig({
  base: './',
  server: { host: '127.0.0.1', port: 47321, strictPort: true },
  preview: { host: '127.0.0.1', port: 47322, strictPort: true },
  build: { modulePreload: false, assetsInlineLimit: Infinity },
  plugins: [inlineBundle()],
});
