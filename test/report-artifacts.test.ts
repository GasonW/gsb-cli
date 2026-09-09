import {strict as assert} from 'node:assert';
import {test} from 'node:test';
import {createHash} from 'node:crypto';
import {mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {bundleReportArtifacts} from '../src/report-artifacts.js';

test('archives exact bytes and maps legacy download links to distinct content-addressed files', () => {
 const root=mkdtempSync(join(tmpdir(),'report-artifacts-'));
 try {
  mkdirSync(join(root,'tasks/a'),{recursive:true});mkdirSync(join(root,'tasks/b'),{recursive:true});
  writeFileSync(join(root,'tasks/a/input.jsonl'),'{"query":"你好"}\r\n');
  writeFileSync(join(root,'tasks/b/input.jsonl'),'{"query":"另一个"}\n');
  const html=['a','b'].map(id=>`<a class="artifact-download" href="old" data-web-href="../artifacts/download?path=tasks/${id}/input.jsonl" download>下载</a>`).join('');
  const bundle=bundleReportArtifacts(html,'/tmp/report.html',root);
  assert.equal(Object.keys(bundle.files).length,2);
  assert.deepEqual(Object.values(bundle.files),['{"query":"你好"}\r\n','{"query":"另一个"}\n']);
  assert.equal((bundle.html.match(/download="input.jsonl"/g)||[]).length,2);
  assert.equal(bundle.html.includes('artifacts/download?'),false);
  for(const name of Object.keys(bundle.files)) assert.ok(bundle.html.includes(`./${name}`));
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('missing files and symlinks outside workspace block publication', () => {
 const root=mkdtempSync(join(tmpdir(),'report-artifacts-'));
 try {
  mkdirSync(join(root,'tasks'));symlinkSync('/etc/passwd',join(root,'tasks/escape.jsonl'));
  for(const name of ['missing','escape']){
   const html=`<a class="artifact-download" data-workspace-path="tasks/${name}.jsonl">下载</a>`;
   assert.throws(()=>bundleReportArtifacts(html,'/tmp/report.html',root));
  }
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('large attachment download restores and verifies original bytes instead of downloading its envelope', async () => {
 const {runInNewContext}=await import('node:vm');
 const {webcrypto}=await import('node:crypto');
 const root=mkdtempSync(join(tmpdir(),'report-artifacts-'));
 try {
  mkdirSync(join(root,'tasks'));
  const original=JSON.stringify({text:'x'.repeat(33*1024*1024)})+'\n';
  writeFileSync(join(root,'tasks/large.jsonl'),original);
  const bundled=bundleReportArtifacts('<a class="artifact-download" data-workspace-path="tasks/large.jsonl">下载</a>','/tmp/report.html',root);
  const names=Object.keys(bundled.files);
  assert.ok(names.length>0);
  assert.ok(Object.values(bundled.files).every(s=>Buffer.byteLength(s)<12*1024*1024));
  const hash=bundled.html.match(/data-artifact-sha256="([a-f0-9]+)"/)![1];
  const link={dataset:{artifactParts:JSON.stringify(names),artifactSha256:hash} as Record<string,string>,download:'large.jsonl',textContent:'下载',title:''};
  let handler: (e:unknown)=>Promise<void> = async ()=>{};
  let downloaded: Blob | undefined;
  let clicked=false;
  class TestURL extends URL {static createObjectURL(blob:Blob):string{downloaded=blob;return 'blob:test';}static revokeObjectURL():void{}}
  const document={addEventListener: (_:string, fn:typeof handler)=>{handler=fn;},createElement:()=>({click:()=>{clicked=true;},remove:()=>{}}),body:{appendChild:()=>{}}};
  const script=bundled.html.match(/<script data-report-artifact-download>([\s\S]*?)<\/script>/)![1];
  runInNewContext(script,{document,fetch:async(url:URL)=>new Response(bundled.files[decodeURIComponent(url.pathname.split('/').pop()!)]),location:{href:'https://example.test/tasks/t/report/decision_report.html'},URL:TestURL,Response,Blob,DecompressionStream,crypto:webcrypto,Uint8Array,atob,setTimeout:()=>0});
  const event={target:{closest:()=>link},preventDefault:()=>{}};
  await handler(event);
  assert.equal(clicked,true);assert.equal(await downloaded!.text(),original);
  clicked=false;link.dataset.artifactSha256='bad';await handler(event);
  assert.equal(clicked,false);assert.equal(link.textContent,'下载失败，点击重试');
 }finally{rmSync(root,{recursive:true,force:true});}
});


test('bundles lazy report evidence with a verified content address', () => {
 const root=mkdtempSync(join(tmpdir(),'report-evidence-'));
 try {
  mkdirSync(join(root,'tasks'));
  const content=JSON.stringify({response:'完整回答',trace_summary:{steps:[]}});
  writeFileSync(join(root,'tasks','panel.json'),content);
  const digest=createHash('sha256').update(content).digest('hex');
  const html=`<a hidden class="report-evidence-source" data-workspace-path="tasks/panel.json" data-sha256="${digest}"></a>`;
  const bundle=bundleReportArtifacts(html,'/tmp/report.html',root);
  assert.equal(bundle.files[`evidence-${digest}.json`],content);
  assert.ok(bundle.html.includes(`data-web-href="./evidence-${digest}.json"`));
  assert.throws(()=>bundleReportArtifacts(html.replace(digest,'0'.repeat(64)),'/tmp/report.html',root),/checksum/);
 } finally {rmSync(root,{recursive:true,force:true});}
});
