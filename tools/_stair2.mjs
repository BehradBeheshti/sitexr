import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname } from 'node:path';
import puppeteer from 'puppeteer-core';
const dist='/home/dicelabs/sitexr/dist';
const MIME={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.webp':'image/webp','.bin':'application/octet-stream','.glb':'model/gltf-binary'};
const server=createServer(async(req,res)=>{try{let p=decodeURIComponent(new URL(req.url,'http://x').pathname);if(p.endsWith('/'))p+='index.html';const f=join(dist,p);await stat(f);res.writeHead(200,{'content-type':MIME[extname(f)]??'application/octet-stream'});res.end(await readFile(f));}catch{res.writeHead(404);res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base=`http://127.0.0.1:${server.address().port}/`;
const [site,x0,x1,z0,z1,top]=process.argv.slice(2).map((v,i)=>i?Number(v):v);
const b=await puppeteer.launch({executablePath:'/usr/bin/google-chrome',headless:'new',args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const p=await b.newPage();await p.setViewport({width:800,height:520});
await p.evaluateOnNewDocument(()=>{try{localStorage.setItem('sitexr.comfort.v1',JSON.stringify({tutorialDone:true,quality:'high'}));}catch{}});
await p.goto(`${base}?site=${site}`,{waitUntil:'domcontentloaded'});
await p.waitForFunction(()=>{const x=document.getElementById('enter');return !!x&&!x.disabled;},{timeout:600000});
await p.evaluate(()=>document.getElementById('enter').click());
await new Promise(r=>setTimeout(r,4000));
const grid=await p.evaluate(({x0,x1,z0,z1,top})=>{
  const c=window.__sitexr.rig.collision, out=[];
  const nx=14, nz=8;
  for(let j=0;j<nz;j++){
    const z=z0+(z1-z0)*j/(nz-1), row=[];
    for(let i=0;i<nx;i++){
      const x=x0+(x1-x0)*i/(nx-1);
      const hit=c.queryRay(x, top, z, 0,-1,0, top+15);
      row.push(hit? +hit.y.toFixed(2) : null);
    }
    out.push({z:+z.toFixed(1), row, xs: Array.from({length:nx},(_,i)=>+(x0+(x1-x0)*i/(nx-1)).toFixed(1))});
  }
  return out;
},{x0,x1,z0,z1,top});
console.log(`${site} surface, x ${x0}..${x1}, z ${z0}..${z1}`);
console.log('        ' + grid[0].xs.map(v=>String(v).padStart(6)).join(''));
for(const {z,row} of grid) console.log(`  z=${String(z).padStart(5)} ` + row.map(v=>v===null?'     -':String(v).padStart(6)).join(''));
await b.close();server.close();
