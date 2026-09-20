import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname } from 'node:path';
import puppeteer from 'puppeteer-core';
const dist='/home/dicelabs/sitexr/dist';
const MIME={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.webp':'image/webp','.bin':'application/octet-stream','.glb':'model/gltf-binary'};
const server=createServer(async(req,res)=>{try{let p=decodeURIComponent(new URL(req.url,'http://x').pathname);if(p.endsWith('/'))p+='index.html';const f=join(dist,p);await stat(f);res.writeHead(200,{'content-type':MIME[extname(f)]??'application/octet-stream'});res.end(await readFile(f));}catch{res.writeHead(404);res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base=`http://127.0.0.1:${server.address().port}/`;
const b=await puppeteer.launch({executablePath:'/usr/bin/google-chrome',headless:'new',args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const p=await b.newPage();await p.setViewport({width:1280,height:800});
const errs=[];p.on('pageerror',e=>errs.push(e.message));p.on('console',m=>{if(m.type()==='error')errs.push('console: '+m.text());});
await p.evaluateOnNewDocument(()=>{try{localStorage.setItem('sitexr.comfort.v1',JSON.stringify({tutorialDone:true,quality:'high'}));}catch{}});
await p.goto(`${base}?site=office`,{waitUntil:'domcontentloaded'});
await p.waitForFunction(()=>!document.getElementById('enter')?.disabled,{timeout:600000});
await p.evaluate(()=>document.getElementById('enter').click());
await new Promise(r=>setTimeout(r,4000));
const info=await p.evaluate(()=>{
  const qa=window.__sitexr;
  return { hasDoors: !!qa.doors, leaves: qa.doors ? qa.doors.leaves.length : 0,
           openable: qa.doors ? qa.doors.openable.length : 0,
           sample: qa.doors ? qa.doors.debugState().slice(0,3) : null };
});
console.log('doors:', JSON.stringify(info));
const S='/tmp/claude-1000/-home-dicelabs/c5d5457e-a023-40c3-ab5b-7b33af72d887/scratchpad';
const place=(x,z,look,floor)=>p.evaluate(({x,z,look,floor})=>{
  const qa=window.__sitexr, cm=qa.viewer.internals.cameraManager();
  const st=qa.rig.findStand(x,z,floor); const V=st.constructor;
  qa.viewer.state.cameraMode='walk';
  cm.camera.look(new V(st.x,st.y+1.62,st.z), new V(look[0],look[1],look[2])); cm.snap();
  qa.viewer.app.renderNextFrame=true;
},{x,z,look,floor});
const views = [['a',4,-8.4,[7.4,1.6,-8.4]],['b',10,-8.4,[7.5,1.6,-8.4]],['c',7.4,-4,[7.45,1.6,-8.4]],['d',2,-10.5,[2.2,1.6,-8]]];
for (const [n,x,z,look] of views) {
  const st = await p.evaluate(({x,z})=>{const s=window.__sitexr.rig.findStand(x,z,0);return [+s.x.toFixed(1),+s.y.toFixed(2),+s.z.toFixed(1)];},{x,z});
  await place(x,z,look,0);
  await new Promise(r=>setTimeout(r,2200));
  await p.screenshot({path:`${S}/probe-${n}.png`});
  console.log('probe',n,'stand',st.join(','));
}
await place(4,-8.4,[7.4,1.6,-8.4],0);
await new Promise(r=>setTimeout(r,2200));
await p.screenshot({path:`${S}/door-shut.png`});
const opened=await p.evaluate(()=>{
  const qa=window.__sitexr; let n=0;
  for(const l of qa.doors.leaves){ if(l.openable){ l.set(1); n++; } }
  return n;
});
console.log('leaves opened:', opened);
await new Promise(r=>setTimeout(r,4000));
await p.screenshot({path:`${S}/door-open.png`});
console.log('state after:', JSON.stringify((await p.evaluate(()=>window.__sitexr.doors.debugState().slice(0,3)))));
console.log('errors:', errs.length?errs.slice(0,4).join(' | '):'none');
await b.close();server.close();
