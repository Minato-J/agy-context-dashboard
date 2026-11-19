import test from 'node:test';
import assert from 'node:assert/strict';
import {Script,runInNewContext} from 'node:vm';
import {readFileSync} from 'node:fs';
import {panelAppSource,panelPageSource} from '../panel-source.mjs';

test('sidecar bundle parses as classic JavaScript and waits for its DOM',()=>{
 const source=panelAppSource();assert.doesNotThrow(()=>new Script(source));
 const handlers=[];const window={};
 runInNewContext(source,{window,document:{readyState:'loading',addEventListener:(...args)=>handlers.push(args)}});
 assert.equal(window.__agPulsePanelInstalled,undefined);assert.equal(handlers.length,1);
 assert.equal(handlers[0][0],'DOMContentLoaded');assert.equal(handlers[0][2].once,true);
});

test('an incomplete sidecar document does not register listeners against missing widgets',()=>{
 const window={};assert.doesNotThrow(()=>runInNewContext(panelAppSource(),{window,document:{readyState:'complete',querySelector:()=>null}}));
 assert.equal(window.__agPulsePanelInstalled,undefined);
});

test('panel HTML versions script and styles together using their source content',()=>{
 const html=panelPageSource();const versions=[...html.matchAll(/(?:theme\.css|styles\.css|app\.js)\?v=([a-f0-9]{16})/g)].map(m=>m[1]);
 assert.equal(versions.length,3);assert.equal(new Set(versions).size,1);assert.ok(html.includes(`content="${versions[0]}"`));
 assert.match(html,/<script defer src="\/app\.js\?v=/);assert.doesNotMatch(html,/type="module"/);
});

test('sidecar version badge follows the installed manifest and invalidates all asset URLs',()=>{
 const current=JSON.parse(readFileSync(new URL('../../../plugin.json',import.meta.url),'utf8')).version;
 const badge=html=>html.match(/id="panel-version"[^>]*>([^<]*)<\/span>/)?.[1];
 assert.equal(badge(panelPageSource()),'v'+current);
 const render=version=>panelPageSource({readManifest:()=>JSON.stringify({name:'antigravity-pulse',version})});
 const first=render('9.8.7'),next=render('9.8.8');
 assert.equal(badge(first),'v9.8.7');assert.equal(badge(next),'v9.8.8');
 assert.match(first,/id="panel-name" title="Antigrative Dashboard v9\.8\.7"/);
 const keys=html=>[...html.matchAll(/(?:theme\.css|styles\.css|app\.js)\?v=([a-f0-9]{16})/g)].map(match=>match[1]);
 assert.equal(new Set(keys(first)).size,1);assert.equal(new Set(keys(next)).size,1);
 assert.notEqual(keys(first)[0],keys(next)[0],'Manifest-only changes must invalidate the served page assets');
 assert.equal(badge(render('9.8.7-preview.2+build.4')),'v9.8.7-preview.2+build.4');
});

test('missing, malformed and unrelated manifests hide the badge without breaking the page',()=>{
 for(const manifest of [null,[],{}, {version:'1.2.3'}, {name:'other',version:'1.2.3'},
  ...[null,17,'','v1.2.3','1.2','01.2.3','1.2.3 ", onclick="alert(1)','1.2.3-'+ 'x'.repeat(64)].map(version=>({name:'antigravity-pulse',version}))]){
  const html=panelPageSource({readManifest:()=>JSON.stringify(manifest)});
  assert.match(html,/<span class="version-tag" id="panel-version" hidden><\/span>/);
  assert.doesNotMatch(html,/id="panel-name" title=/);assert.match(html,/<script defer src="\/app\.js\?v=/);
 }
 for(const readManifest of [()=>'{bad json',()=>{throw Error('ENOENT');}]){
  assert.match(panelPageSource({readManifest}),/id="panel-version" hidden><\/span>/);
 }
});

function createPanelDom(html){
 const toKebab=k=>k.replace(/[A-Z]/g,m=>'-'+m.toLowerCase());
 const toCamel=k=>k.replace(/-([a-z])/g,(_,c)=>c.toUpperCase());
 const makeStyle=()=>{
  const map=new Map();
  return new Proxy({
   setProperty(k,v){map.set(k,String(v));},
   getPropertyValue(k){return map.get(k)||'';},
   removeProperty(k){map.delete(k);},
  },{
   get(target,prop){return prop in target?target[prop]:(map.get(toKebab(String(prop)))||'');},
   set(target,prop,val){map.set(toKebab(String(prop)),String(val));return true;},
  });
 };
 class TextNode{constructor(data){this.nodeType=3;this.data=String(data);this.parentNode=null;}}
 class El{
  constructor(tag,ns='http://www.w3.org/1999/xhtml'){
   this.nodeType=1;this.localName=tag.toLowerCase();this.tagName=this.localName.toUpperCase();this.namespaceURI=ns;
   this.attributes=new Map();this.childNodes=[];this.parentNode=null;this.listeners=new Map();this.style=makeStyle();this.value='';this.checked=false;this.disabled=false;this.tabIndex=0;this.open=false;
   this.classList={
    add:(...c)=>{const s=new Set(this.className.split(/\s+/).filter(Boolean));for(const x of c)s.add(x);this.className=[...s].join(' ');},
    remove:(...c)=>{const s=new Set(this.className.split(/\s+/).filter(Boolean));for(const x of c)s.delete(x);this.className=[...s].join(' ');},
    toggle:(c,f)=>{const has=this.classList.contains(c),want=f===undefined?!has:Boolean(f);if(want)this.classList.add(c);else this.classList.remove(c);return want;},
    contains:c=>this.className.split(/\s+/).includes(c),
   };
   this.dataset=new Proxy({},{
    get:(_,k)=>this.attributes.get('data-'+toKebab(String(k))),
    set:(_,k,v)=>{this.attributes.set('data-'+toKebab(String(k)),String(v));return true;},
    deleteProperty:(_,k)=>{this.attributes.delete('data-'+toKebab(String(k)));return true;},
   });
  }
  get parentElement(){return this.parentNode?.nodeType===1?this.parentNode:null;}
  get ownerDocument(){return document;}
  get children(){return this.childNodes.filter(n=>n.nodeType===1);}
  get id(){return this.attributes.get('id')||'';}
  set id(v){this.attributes.set('id',String(v));}
  get className(){return this.attributes.get('class')||'';}
  set className(v){this.attributes.set('class',String(v));}
  get hidden(){return this.attributes.has('hidden');}
  set hidden(v){if(v)this.attributes.set('hidden','');else this.attributes.delete('hidden');}
  get title(){return this.attributes.get('title')||'';}
  set title(v){if(v===null||v===undefined||v==='')this.attributes.delete('title');else this.attributes.set('title',String(v));}
  get textContent(){return this.childNodes.map(n=>n.nodeType===3?n.data:n.textContent).join('');}
  set textContent(v){this.childNodes=v===''?[]:[new TextNode(v)];if(this.childNodes[0])this.childNodes[0].parentNode=this;}
  set innerHTML(_){throw Error('Unexpected innerHTML assignment on '+this.id);}
  setAttribute(k,v){this.attributes.set(k,String(v));}
  getAttribute(k){return this.attributes.has(k)?this.attributes.get(k):null;}
  hasAttribute(k){return this.attributes.has(k);}
  removeAttribute(k){this.attributes.delete(k);}
  append(...nodes){for(const n of nodes){const node=typeof n==='string'?new TextNode(n):n;node.parentNode=this;this.childNodes.push(node);}}
  replaceChildren(...nodes){this.childNodes=[];this.append(...nodes);}
  addEventListener(type,fn){if(!this.listeners.has(type))this.listeners.set(type,[]);this.listeners.get(type).push(fn);}
  removeEventListener(type,fn){this.listeners.set(type,(this.listeners.get(type)||[]).filter(f=>f!==fn));}
  matches(selector){
   return selector.split(',').some(raw=>{
    const s=raw.trim();
    if(s===':popover-open')return this._popoverOpen===true;
    const tagM=s.match(/^([a-z][\w-]*)/i);if(tagM&&this.localName!==tagM[1].toLowerCase())return false;
    for(const m of s.matchAll(/\.([a-z0-9_-]+)/gi))if(!this.classList.contains(m[1]))return false;
    for(const m of s.matchAll(/#([a-z0-9_-]+)/gi))if(this.id!==m[1])return false;
    for(const m of s.matchAll(/\[([^=\]]+)(?:="([^"]*)"|='([^']*)'|=([^\]]+))?\]/g)){
     const val=this.getAttribute(m[1]);if(val===null)return false;
     const want=m[2]??m[3]??m[4];if(want!==undefined&&val!==want)return false;
    }
    return true;
   });
  }
  querySelectorAll(selector){
   const out=[];
   const walk=node=>{for(const child of node.children){if(child.matches(selector))out.push(child);walk(child);}};
   walk(this);return out;
  }
  querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
  getBoundingClientRect(){return {left:10,top:10,right:120,bottom:34,width:110,height:24};}
  getContext(){return null;}
  showPopover(){this._popoverOpen=true;}
  hidePopover(){this._popoverOpen=false;}
  focus(){}
  remove(){if(this.parentNode)this.parentNode.childNodes=this.parentNode.childNodes.filter(c=>c!==this);this.parentNode=null;}
 }
 const htmlEl=new El('html'),bodyEl=new El('body');htmlEl.append(bodyEl);
 const bodyMatch=html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
 const bodyMarkup=bodyMatch?bodyMatch[1].replace(/<script[\s\S]*?<\/script>/gi,''):'';
 const stack=[bodyEl],voidTags=new Set(['meta','link','br','hr','img','input']);
 const token=/<\/?([a-z][\w-]*)(\s[^<>]*?)?\s*\/?\s*>/gi;let off=0;
 for(let m;(m=token.exec(bodyMarkup));){
  if(m.index>off){const txt=bodyMarkup.slice(off,m.index);if(txt)stack.at(-1).append(new TextNode(txt));}
  const tag=m[1].toLowerCase(),closing=m[0][1]==='/';
  if(closing){if(stack.length>1&&stack.at(-1).localName===tag)stack.pop();}
  else{
   const el=new El(tag);const attrs=m[2]||'',attr=/([^\s=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s]+)))?/g;
   for(let a;(a=attr.exec(attrs));){if(a[1]!=='/')el.setAttribute(a[1],a[2]??a[3]??a[4]??'');}
   stack.at(-1).append(el);if(!m[0].endsWith('/>')&&!voidTags.has(tag))stack.push(el);
  }
  off=token.lastIndex;
 }
 const byId=id=>{const walk=n=>{if(n.id===id)return n;for(const c of n.children){const r=walk(c);if(r)return r;}return null;};return walk(htmlEl);};
 const document={
  readyState:'complete',hidden:false,documentElement:htmlEl,body:bodyEl,defaultView:null,
  getElementById:byId,querySelector:s=>htmlEl.querySelector(s),querySelectorAll:s=>htmlEl.querySelectorAll(s),
  createElement:t=>new El(t),createElementNS:(ns,t)=>new El(t,ns),createTextNode:d=>new TextNode(d),
  addEventListener(){},removeEventListener(){},
 };
 return {document,El};
}

test('sidecar panel mirrors speed requestError badge/details safely via textContent and clears on recovery',async()=>{
 const html=panelPageSource();
 assert.match(html,/<section class="request-error" id="speed-request-error"[^>]*hidden>/);
 const css=readFileSync(new URL('../styles.css',import.meta.url),'utf8');
 assert.match(css,/\.metric-chip\[data-request-error=true\]::before/);
 assert.match(css,/#speed-tab\[data-request-error=true\] \.unit/);
 assert.match(css,/\.request-error-diag:empty\{display:none\}/);
 assert.match(css,/overflow-wrap:anywhere/);
 assert.match(css,/white-space:pre-wrap/);
 assert.match(css,/max-height:96px/);
 const {document,El}=createPanelDom(html);
 let currentSnapshot={
  connection:'live',groups:[],serverTime:new Date().toISOString(),
  speed:{tps:42.5,latestTps:42.5,peakTps:50,rounds:1,steps:2,measuredRequests:1,modelSeconds:1.2,toolSeconds:0.3,ttftSeconds:0.4,counts:{responseOutput:100,thinkingOutput:20},requestError:{kind:'rate_limited',retryAfterSec:25,diagnostic:'429 <script>alert(1)</script><img src=x onerror=alert(2)>'}},
 };
 let currentPrefs={language:'en',speedStyle:'minimal'};
 const timers=[];
 const fetchStub=async(url,opts)=>{
  if(String(url).startsWith('/api/preferences')){
   if(opts?.body)Object.assign(currentPrefs,JSON.parse(opts.body));
   return {ok:true,json:async()=>({...currentPrefs})};
  }
  return {ok:true,json:async()=>structuredClone(currentSnapshot)};
 };
 const window={innerWidth:420,innerHeight:640,addEventListener(){},removeEventListener(){},matchMedia:()=>({matches:false,addEventListener(){},removeEventListener(){}})};
 document.defaultView=window;
 class OptionMock extends El{constructor(text,val){super('option');this.textContent=text;this.value=val;}}
 class ObserverMock{observe(){}disconnect(){}}
 const ctx={
  window,document,fetch:fetchStub,Option:OptionMock,Node:El,MutationObserver:ObserverMock,ResizeObserver:ObserverMock,
  getComputedStyle:()=>({getPropertyValue:()=>'',color:'#e1e3e7',backgroundColor:'#1c1d1f',fontFamily:'sans-serif',fontSize:'12px',colorScheme:'dark'}),
  matchMedia:window.matchMedia,localStorage:{getItem:()=>null,setItem(){}},
  setTimeout:(fn)=>{timers.push(fn);return timers.length;},clearTimeout(){},setInterval:()=>1,clearInterval(){},
  Intl,Date,JSON,Math,Number,String,Array,Object,Boolean,Set,Map,RegExp,Error,Promise,URL,URLSearchParams,performance,queueMicrotask,console,
 };
 runInNewContext(panelAppSource(),ctx);
 await new Promise(r=>setTimeout(r,20));
 const tab=document.getElementById('speed-tab');
 const box=document.getElementById('speed-request-error');
 const title=document.getElementById('speed-request-error-title');
 const detail=document.getElementById('speed-request-error-detail');
 const diag=document.getElementById('speed-request-error-diag');
 assert.equal(tab.getAttribute('data-request-error'),'true');
 assert.equal(tab.getAttribute('aria-label'),'Request failed: Rate limited (429)');
 assert.equal(tab.title,'Request failed: Rate limited (429)');
 assert.equal(box.hidden,false);
 assert.equal(box.dataset.kind,'rate_limited');
 assert.equal(title.textContent,'Rate limited (429)');
 assert.match(detail.textContent,/Retry in ~25s\./);
 assert.equal(diag.textContent,'429 <script>alert(1)</script><img src=x onerror=alert(2)>');
 assert.equal(diag.children.length,0,'diagnostic must be rendered purely as text, never HTML nodes');
 assert.equal(document.querySelectorAll('script').length,0);
 assert.equal(document.querySelectorAll('img').length,0);
 // Locale switch and context_overflow with empty diagnostic update cleanly.
 currentSnapshot.preferences={language:'zh-CN',speedStyle:'minimal'};
 currentSnapshot.speed.requestError={kind:'context_overflow',retryAfterSec:null,diagnostic:''};
 timers.at(-1)();
 await new Promise(r=>setTimeout(r,20));
 assert.equal(tab.getAttribute('data-request-error'),'true');
 assert.equal(tab.getAttribute('aria-label'),'请求失败：上下文超限');
 assert.equal(box.hidden,false);
 assert.equal(box.dataset.kind,'context_overflow');
 assert.equal(title.textContent,'上下文超限');
 assert.match(detail.textContent,/上下文上限/);
 assert.equal(diag.textContent,'');
 // Recovery clears badge and hides the request-error box cleanly.
 currentSnapshot.speed.requestError=null;
 const nextPoll=timers.at(-1);assert.equal(typeof nextPoll,'function');
 nextPoll();
 await new Promise(r=>setTimeout(r,20));
 assert.equal(tab.getAttribute('data-request-error'),null);
 assert.equal(tab.getAttribute('aria-label'),null);
 assert.equal(tab.title,'42.5 tok/s');
 assert.equal(box.hidden,true);
 assert.equal(box.getAttribute('data-kind'),null);
 assert.equal(title.textContent,'');
 assert.equal(detail.textContent,'');
 assert.equal(diag.textContent,'');
});
