import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path';
export function bundleReportArtifacts(html, reportPath, workspaceArg) {
    const files = {};
    let root = workspaceArg ? resolve(workspaceArg) : dirname(resolve(reportPath));
    if (!workspaceArg) {
        while (basename(root) !== 'workspace' && dirname(root) !== root)
            root = dirname(root);
    }
    const decode = (s) => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
    const escape = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
    const rendered = html.replace(/<a\b[^>]*>/gi, tag => {
        const attrs = new Map([...tag.matchAll(/([\w-]+)\s*=\s*(["'])(.*?)\2/gs)].map(m => [m[1], decode(m[3])]));
        if (!attrs.get('class')?.split(/\s+/).includes('artifact-download'))
            return tag;
        if (attrs.has('data-artifact-parts'))
            return tag;
        const web = attrs.get('data-web-href') || '';
        if (/^(?:\.\/)?artifact-[a-f0-9]{64}-/.test(web))
            return tag;
        const workspacePath = attrs.get('data-workspace-path') ||
            (web.includes('artifacts/download?') ? new URL(web, 'https://report.invalid/').searchParams.get('path') : '');
        if (!workspacePath)
            throw new Error('Report attachment is missing its workspace path');
        if (!workspaceArg && basename(root) !== 'workspace')
            throw new Error('Report attachments require --workspace-root');
        if (!/^(tasks|model_runs|benchmarks|annotation_sets)\//.test(workspacePath))
            throw new Error(`Unsupported artifact path: ${workspacePath}`);
        const workspace = realpathSync(root);
        const path = realpathSync(resolve(workspace, workspacePath));
        const rel = relative(workspace, path);
        if (rel.startsWith('..') || isAbsolute(rel))
            throw new Error('Artifact escapes workspace');
        if (!/\.(jsonl|json)$/i.test(path))
            throw new Error('Report artifacts must be JSON or JSONL');
        if (!existsSync(path))
            throw new Error(`Missing artifact: ${workspacePath}`);
        const bytes = readFileSync(path);
        const content = bytes.toString('utf8');
        if (!Buffer.from(content).equals(bytes))
            throw new Error('Artifact must be valid UTF-8');
        const name = `artifact-${createHash('sha256').update(bytes).digest('hex')}-${basename(path)}`;
        if (bytes.length > 32 * 1024 * 1024) {
            const compressed = gzipSync(bytes);
            const parts = [];
            for (let offset = 0; offset < compressed.length; offset += 8 * 1024 * 1024) {
                const part = `${name}.part-${parts.length}.jsonl`;
                parts.push(part);
                files[part] = JSON.stringify({ gzip_base64: compressed.subarray(offset, offset + 8 * 1024 * 1024).toString('base64') }) + '\n';
            }
            return tag.replace(/\s(?:href|data-web-href|download)(?:\s*=\s*(?:"[^"]*"|'[^']*'))?/g, '')
                .replace(/>$/, ` href="#downloads" data-web-href="#downloads" data-artifact-parts="${escape(JSON.stringify(parts))}" data-artifact-sha256="${createHash('sha256').update(bytes).digest('hex')}" download="${escape(basename(path))}">`);
        }
        files[name] = content;
        const href = `./${encodeURIComponent(name)}`;
        return tag.replace(/\s(?:href|data-web-href|download)(?:\s*=\s*(?:"[^"]*"|'[^']*'))?/g, '')
            .replace(/>$/, ` href="${escape(href)}" data-web-href="${escape(href)}" download="${escape(basename(path))}">`);
    });
    return { html: rendered.includes('data-artifact-parts=') && !rendered.includes('data-report-artifact-download') ? rendered + ARTIFACT_DOWNLOAD_SCRIPT : rendered, files };
}
const ARTIFACT_DOWNLOAD_SCRIPT = `<script data-report-artifact-download>
document.addEventListener('click', async function(event) {
 const link = event.target.closest && event.target.closest('a[data-artifact-parts]');
 if (!link) return;
 event.preventDefault();
 if (link.dataset.downloading) return;
 const label = link.textContent;
 link.dataset.downloading = '1'; link.textContent = '正在准备下载…';
 try {
  const chunks = [];
  for (const part of JSON.parse(link.dataset.artifactParts)) {
   const response = await fetch(new URL(part, location.href));
   if (!response.ok) throw new Error('HTTP ' + response.status);
   const data = await response.json();
   const binary = atob(data.gzip_base64);
   chunks.push(Uint8Array.from(binary, c => c.charCodeAt(0)));
  }
  const raw = await new Response(new Blob(chunks).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', raw)), b => b.toString(16).padStart(2, '0')).join('');
  if (digest !== link.dataset.artifactSha256) throw new Error('附件校验失败');
  const url = URL.createObjectURL(new Blob([raw], {type:'application/octet-stream'}));
  const save = document.createElement('a'); save.href = url; save.download = link.download;
  document.body.appendChild(save); save.click(); save.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000); link.textContent = label;
 } catch (error) { link.textContent = '下载失败，点击重试'; link.title = error.message; }
 finally { delete link.dataset.downloading; }
});
</script>`;
