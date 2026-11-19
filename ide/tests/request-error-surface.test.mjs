import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const require=createRequire(import.meta.url);
const createIdeSurface=require('../surface.cjs');
const i18nSource=readFileSync(new URL('../../compat/i18n.cjs',import.meta.url),'utf8');
const themeSource=readFileSync(new URL('../../compat/theme.cjs',import.meta.url),'utf8');
const widgetSource=readFileSync(new URL('../../compat/inline-widget.cjs',import.meta.url),'utf8');
const surfaceSource=readFileSync(new URL('../surface.cjs',import.meta.url),'utf8');
const extract=s=>s.slice(s.indexOf('module.exports = ')+17).trim().replace(/;$/,'');

function createTrustedDom(){
 const toKebab=k=>k.replace(/[A-Z]/g,m=>'-'+m.toLowerCase());
 const makeStyle=()=>{
  const map=new Map();
  return new Proxy({
   cssText:'',
   setProperty(k,v){map.set(k,String(v));},
   getPropertyValue(k){return map.get(k)||'';},
   removeProperty(k){map.delete(k);},
  },{
   get(target,prop){return prop in target?target[prop]:(map.get(toKebab(String(prop)))||'');},
   set(target,prop,val){
    if(prop==='cssText'){target.cssText=String(val);return true;}
    map.set(toKebab(String(prop)),String(val));return true;
   },
  });
 };
 class BaseNode{
  constructor(nodeType){this.nodeType=nodeType;this.childNodes=[];this.parentNode=null;}
  get isConnected(){let cur=this;while(cur){if(cur===document.documentElement||cur===document||cur._host?.isConnected)return true;cur=cur.parentNode;}return false;}
  get children(){return this.childNodes.filter(n=>n.nodeType===1);}
  get childElementCount(){return this.children.length;}
  get ownerDocument(){return document;}
  get nextSibling(){if(!this.parentNode)return null;const i=this.parentNode.childNodes.indexOf(this);return i>=0?this.parentNode.childNodes[i+1]||null:null;}
  get previousElementSibling(){if(!this.parentNode)return null;const els=this.parentNode.children,i=els.indexOf(this);return i>0?els[i-1]:null;}
  after(...nodes){if(!this.parentNode)return;const ref=this.nextSibling;for(const n of nodes)this.parentNode.insertBefore(typeof n==='string'?new TextNode(n):n,ref);}
  contains(other){let cur=other;while(cur){if(cur===this)return true;cur=cur.parentNode;}return false;}
  append(...nodes){
   for(const n of nodes){
    if(n?.nodeType===11){const moved=[...n.childNodes];n.childNodes=[];this.append(...moved);continue;}
    const node=n instanceof BaseNode?n:new TextNode(n);
    if(node.parentNode)node.parentNode.childNodes=node.parentNode.childNodes.filter(c=>c!==node);
    node.parentNode=this;this.childNodes.push(node);
   }
  }
  insertBefore(node,ref){
   if(node.parentNode)node.parentNode.childNodes=node.parentNode.childNodes.filter(c=>c!==node);
   node.parentNode=this;
   const idx=ref?this.childNodes.indexOf(ref):-1;
   if(idx<0)this.childNodes.push(node);else this.childNodes.splice(idx,0,node);
   return node;
  }
  replaceChildren(...nodes){this.childNodes=[];this.append(...nodes);}
  remove(){if(this.parentNode)this.parentNode.childNodes=this.parentNode.childNodes.filter(c=>c!==this);this.parentNode=null;}
 }
 class TextNode extends BaseNode{constructor(data){super(3);this.data=String(data);}}
 class Fragment extends BaseNode{constructor(){super(11);}}
 class El extends BaseNode{
  constructor(tag,ns='http://www.w3.org/1999/xhtml'){
   super(1);this.localName=tag.toLowerCase();this.tagName=this.localName.toUpperCase();this.namespaceURI=ns;
   this.attributes=new Map();this.listeners=new Map();this.style=makeStyle();this.inert=false;this.open=false;this.shadowRoot=null;
   this._rect=null;
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
  set innerHTML(_){throw Error('Trusted Types violation: innerHTML must never be assigned');}
  setAttribute(k,v){this.attributes.set(k,String(v));}
  getAttribute(k){return this.attributes.has(k)?this.attributes.get(k):null;}
  hasAttribute(k){return this.attributes.has(k);}
  removeAttribute(k){this.attributes.delete(k);}
  attachShadow(){const sr=new El('#shadow-root');sr._host=this;this.shadowRoot=sr;return sr;}
  addEventListener(type,fn){if(!this.listeners.has(type))this.listeners.set(type,[]);this.listeners.get(type).push(fn);}
  removeEventListener(type,fn){this.listeners.set(type,(this.listeners.get(type)||[]).filter(f=>f!==fn));}
  dispatch(type,event={}){for(const fn of this.listeners.get(type)||[])fn({target:this,currentTarget:this,preventDefault(){},stopPropagation(){},...event});}
  matches(selector){
   return selector.split(',').some(raw=>{
    const parts=raw.trim().split(/\s+/);
    const matchesSimple=(el,s)=>{
     if(!el||el.nodeType!==1)return false;
     if(s===':hover')return el._hover===true;
     if(s===':popover-open')return el._popoverOpen===true;
     const bare=s.replace(/\[[^\]]*\]/g,'');
     const tagM=bare.match(/^([a-z][\w-]*)/i);if(tagM&&el.localName!==tagM[1].toLowerCase())return false;
     for(const m of bare.matchAll(/\.([a-z0-9_-]+)/gi))if(!el.classList.contains(m[1]))return false;
     for(const m of bare.matchAll(/#([a-z0-9_-]+)/gi))if(el.id!==m[1])return false;
     for(const m of s.matchAll(/\[([^=\]]+)(?:="([^"]*)"|='([^']*)'|=([^\]]+))?\]/g)){
      const val=el.getAttribute(m[1]);if(val===null)return false;
      const want=m[2]??m[3]??m[4];if(want!==undefined&&val!==want)return false;
     }
     return true;
    };
    if(!matchesSimple(this,parts.at(-1)))return false;
    let cur=this.parentElement;
    for(let i=parts.length-2;i>=0;i--){
     while(cur&&!matchesSimple(cur,parts[i]))cur=cur.parentElement;
     if(!cur)return false;cur=cur.parentElement;
    }
    return true;
   });
  }
  closest(selector){let cur=this;while(cur&&cur.nodeType===1){if(cur.matches(selector))return cur;cur=cur.parentElement;}return null;}
  querySelectorAll(selector){
   const out=[];
   const walk=node=>{for(const child of node.children){if(child.matches(selector))out.push(child);walk(child);}};
   walk(this);return out;
  }
  querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
  getElementById(id){const walk=n=>{if(n.id===id)return n;for(const c of n.children){const r=walk(c);if(r)return r;}return null;};return walk(this);}
  getBoundingClientRect(){
   if(typeof this._rect==='function')return this._rect();
   if(this._rect)return this._rect;
   return {left:240,top:606,right:320,bottom:630,width:80,height:24};
  }
  getClientRects(){return this.hidden?[]:[this.getBoundingClientRect()];}
  get scrollHeight(){
   if(this.id==='speed-card'){
    const err=this.getElementById('speed-request-error');
    return err&&!err.hidden?270:150;
   }
   return 40;
  }
  get offsetHeight(){return this.scrollHeight;}
  get clientHeight(){return this.scrollHeight;}
  get scrollWidth(){return this.getBoundingClientRect().width;}
  get clientWidth(){return this.getBoundingClientRect().width;}
  getContext(){return null;}
  showPopover(){this._popoverOpen=true;}
  hidePopover(){this._popoverOpen=false;}
  focus(){}
 }
 const htmlEl=new El('html'),bodyEl=new El('body');htmlEl.append(bodyEl);
 const document={
  readyState:'complete',hidden:false,activeElement:null,documentElement:htmlEl,body:bodyEl,defaultView:null,
  createElement:t=>new El(t),createElementNS:(ns,t)=>new El(t,ns),createDocumentFragment:()=>new Fragment(),createTextNode:d=>new TextNode(d),
  getElementById:id=>htmlEl.getElementById(id),querySelector:s=>htmlEl.querySelector(s),querySelectorAll:s=>htmlEl.querySelectorAll(s),
  elementFromPoint:()=>null,addEventListener(){},removeEventListener(){},
 };
 return {document,El,BaseNode};
}

test('IDE surface setMarkup whitelist accepts inline-widget requestError template and rejects unsafe tags/attributes',()=>{
 const {document}=createTrustedDom();
 const prevDocument=globalThis.document;
 globalThis.document=document;
 try{
  const surface=createIdeSurface();
  const host=document.createElement('div');
  const template='<section class="request-error" id="speed-request-error" role="alert" hidden><div class="request-error-head"><span class="request-error-icon" aria-hidden="true">!</span><strong class="request-error-title" id="speed-request-error-title"></strong></div><p class="request-error-detail" id="speed-request-error-detail"></p><div class="request-error-diag" id="speed-request-error-diag"></div></section>';
  assert.doesNotThrow(()=>surface.setMarkup(host,template));
  assert.ok(host.getElementById('speed-request-error'));
  assert.ok(host.getElementById('speed-request-error-title'));
  assert.ok(host.getElementById('speed-request-error-detail'));
  assert.ok(host.getElementById('speed-request-error-diag'));
  assert.throws(()=>surface.setMarkup(host,'<script>alert(1)</script>'),/Unsupported dashboard template element/);
  assert.throws(()=>surface.setMarkup(host,'<img src="x">'),/Unsupported dashboard template element/);
  assert.throws(()=>surface.setMarkup(host,'<div onclick="alert(1)"></div>'),/Unsupported dashboard template attribute/);
  assert.throws(()=>surface.setMarkup(host,'<div href="javascript:1"></div>'),/Unsupported dashboard template attribute/);
 }finally{
  globalThis.document=prevDocument;
 }
});

test('inline widget renders speed requestError under Trusted Types, prevents empty-session collapse, repositions open card, and blocks XSS',async()=>{
 const {document,El,BaseNode}=createTrustedDom();
 const convId='11111111-1111-1111-1111-111111111111';
 const box=document.createElement('div');
 box.id='antigravity.agentSidePanelInputBox';
 box._rect={left:100,top:580,right:620,bottom:640,width:520,height:60};
 const editor=document.createElement('div');
 editor.setAttribute('contenteditable','true');editor.setAttribute('role','textbox');
 editor._rect={left:110,top:584,right:610,bottom:602,width:500,height:18};
 const row=document.createElement('div');
 row._rect={left:110,top:606,right:610,bottom:634,width:500,height:28};
 const modelBranch=document.createElement('div');
 modelBranch._rect={left:110,top:606,right:220,bottom:634,width:110,height:28};
 const modelTrigger=document.createElement('button');
 modelTrigger.setAttribute('data-testid','model-selector-trigger');
 modelTrigger.textContent='Gemini 3';
 modelTrigger._rect={left:110,top:606,right:210,bottom:634,width:100,height:28};
 modelBranch.append(modelTrigger);
 row.append(modelBranch);
 box.append(editor,row);
 const region=document.createElement('div');
 region.id='conversation';region.setAttribute('role','region');
 const convView=document.createElement('div');
 convView.setAttribute('data-testid','conversation-view');
 convView.setAttribute('data-cascade-id',convId);
 convView._rect={left:80,top:40,right:640,bottom:660,width:560,height:620};
 convView.append(box);
 region.append(convView);
 document.body.append(region);

 let prefs={language:'en',speedStyle:'minimal',languageGuideDismissed:true,usageGuideDismissed:true};
 let metricsPayload={
  connection:'live',enabled:true,groups:[],preferences:prefs,
  speed:{
   conversationId:convId,requests:0,steps:0,rounds:0,measuredRequests:0,
   tps:null,latestTps:null,peakTps:null,context:null,cache:null,
   requestError:{kind:'auth_error',retryAfterSec:null,diagnostic:'401 Unauthorized <script>alert(1)</script><img src=x onerror=alert(2)>'},
  },
 };
 const intervals=[];
 const window={
  innerWidth:900,innerHeight:700,
  location:{pathname:`/c/${convId}`},
  history:{pushState(){},replaceState(){}},
  addEventListener(){},removeEventListener(){},
  matchMedia:()=>({matches:false,addEventListener(){},removeEventListener(){}}),
  agPulseHost:{
   report(){},
   getPreferences:async()=>({...prefs}),
   setPreferences:async input=>{prefs={...prefs,...input};return {...prefs};},
   getMetrics:async()=>structuredClone(metricsPayload),
  },
 };
 document.defaultView=window;
 class ObserverMock{observe(){}disconnect(){}}
 let fakeNow=Date.now();
 class FakeDate extends Date{
  constructor(...args){super(...(args.length?args:[fakeNow]));}
  static now(){return fakeNow;}
 }
 const ctx={
  window,document,location:window.location,history:window.history,innerWidth:window.innerWidth,innerHeight:window.innerHeight,
  Node:BaseNode,Element:El,HTMLElement:El,MutationObserver:ObserverMock,ResizeObserver:ObserverMock,
  matchMedia:window.matchMedia,localStorage:{getItem:()=>null,setItem(){}},
  getComputedStyle:el=>({
   display:el===row?'flex':'block',flexDirection:'row',position:'static',visibility:'visible',fontFamily:'sans-serif',fontSize:'11px',font:'11px sans-serif',
   color:'#e1e3e7',backgroundColor:'#1c1d1f',colorScheme:'dark',gap:'6px',columnGap:'4px',paddingLeft:'0px',paddingRight:'0px',opacity:'1',
   getPropertyValue:()=>'',
  }),
  requestAnimationFrame:fn=>{fn();return 1;},cancelAnimationFrame(){},
  setTimeout:(fn)=>setTimeout(fn,0),clearTimeout,
  setInterval:(fn)=>{intervals.push(fn);return intervals.length;},clearInterval(){},
  Intl,Date:FakeDate,JSON,Math,Number,String,Array,Object,Boolean,Set,Map,RegExp,Error,Promise,queueMicrotask,console,
 };
 const script=`window.__agPulseI18nFactory=(${extract(i18nSource)});window.__agPulseThemeFactory=(${extract(themeSource)});window.__agPulseSurface=(${extract(surfaceSource)})();(${extract(widgetSource)})();`;
 assert.doesNotThrow(()=>runInNewContext(script,ctx));
 await new Promise(r=>setTimeout(r,30));

 const barHost=row.querySelector('[data-ag-pulse-bar="true"]');
 assert.ok(barHost,'inline widget should mount via IDE Trusted Types surface');
 const sr=barHost.shadowRoot;
 assert.ok(sr,'shadow root should be attached');
 // Verify shadow CSS preserves badge visibility in narrow/icons-only and diagnostic bounds.
 const styleText=sr.querySelector('style').textContent;
 assert.match(styleText,/\[data-card=speed\]\[data-request-error=true\]::after/);
 assert.match(styleText,/\.request-error-diag:empty\{display:none\}/);
 assert.match(styleText,/overflow-wrap:anywhere/);
 assert.match(styleText,/white-space:pre-wrap/);
 assert.match(styleText,/max-height:96px/);
 // 0-token first request error must expand strip out of emptyCompact.
 assert.equal(barHost.dataset.density,'full','0-token requestError must not collapse strip to icons-only');
 const speedChip=sr.querySelector('[data-card="speed"]');
 const speedCard=sr.getElementById('speed-card');
 const errBox=sr.getElementById('speed-request-error');
 const errTitle=sr.getElementById('speed-request-error-title');
 const errDetail=sr.getElementById('speed-request-error-detail');
 const errDiag=sr.getElementById('speed-request-error-diag');
 assert.equal(speedChip.getAttribute('data-request-error'),'true');
 assert.equal(speedChip.getAttribute('aria-label'),'Request failed: Authentication error');
 assert.equal(speedChip.getAttribute('title'),'Request failed: Authentication error');
 assert.equal(errBox.hidden,false);
 assert.equal(errBox.getAttribute('data-kind'),'auth_error');
 assert.equal(errTitle.textContent,'Authentication error');
 assert.match(errDetail.textContent,/authentication|permission/i);
 assert.equal(errDiag.textContent,'401 Unauthorized <script>alert(1)</script><img src=x onerror=alert(2)>');
 assert.equal(errDiag.children.length,0,'diagnostic text must never create child DOM nodes');
 assert.equal(sr.querySelectorAll('script').length,0);
 assert.equal(sr.querySelectorAll('img').length,0);

 // Open the speed hover card and verify position() repositions when error clears/reappears.
 speedChip._rect={left:260,top:606,right:340,bottom:630,width:80,height:24};
 speedChip.dispatch('click');
 assert.equal(speedCard.hidden,false);
 const topWithError=parseFloat(speedCard.style.getPropertyValue('top'));
 assert.equal(topWithError,606-270-9,'open card should position above chip using taller error height');

 // Clear error -> card shrinks and position() shifts top closer to the chip without clipping.
 metricsPayload.speed.requestError=null;
 metricsPayload.speed.tps=55.2;
 metricsPayload.speed.latestTps=55.2;
 metricsPayload.speed.requests=1;
 metricsPayload.speed.measuredRequests=1;
 fakeNow+=3000;
 intervals[0]();
 await new Promise(r=>setTimeout(r,30));
 assert.equal(speedChip.getAttribute('data-request-error'),null);
 assert.equal(speedChip.getAttribute('title'),null);
 assert.equal(speedChip.getAttribute('aria-label'),'Session statistics');
 assert.equal(errBox.hidden,true);
 assert.equal(errTitle.textContent,'');
 assert.equal(errDetail.textContent,'');
 assert.equal(errDiag.textContent,'');
 const topWithoutError=parseFloat(speedCard.style.getPropertyValue('top'));
 assert.equal(topWithoutError,606-150-9,'position() must update open card top when error disappears');
 assert.ok(topWithoutError>topWithError);

 // Switch to zh-CN + cat style + rate_limited with retryAfterSec -> re-renders & repositions cleanly.
 prefs={...prefs,language:'zh-CN',speedStyle:'cat'};
 metricsPayload.preferences=prefs;
 metricsPayload.speed.requestError={kind:'rate_limited',retryAfterSec:22,diagnostic:'429 Too Many Requests'};
 fakeNow+=3000;
 intervals[0]();
 await new Promise(r=>setTimeout(r,30));
 assert.equal(barHost.getAttribute('data-speed-style'),'cat');
 assert.equal(speedChip.getAttribute('data-request-error'),'true');
 assert.equal(speedChip.getAttribute('title'),'请求失败：请求限流 (429)');
 assert.equal(errBox.hidden,false);
 assert.equal(errBox.getAttribute('data-kind'),'rate_limited');
 assert.equal(errTitle.textContent,'请求限流 (429)');
 assert.match(errDetail.textContent,/约 22s 后可重试/);
 assert.equal(parseFloat(speedCard.style.getPropertyValue('top')),606-270-9,'position() must update open card top when error reappears');

 // Switch to zh-TW + context_overflow with empty diagnostic -> re-renders cleanly.
 prefs={...prefs,language:'zh-TW'};
 metricsPayload.preferences=prefs;
 metricsPayload.speed.requestError={kind:'context_overflow',retryAfterSec:null,diagnostic:''};
 fakeNow+=3000;
 intervals[0]();
 await new Promise(r=>setTimeout(r,30));
 assert.equal(speedChip.getAttribute('title'),'請求失敗：上下文超限');
 assert.equal(errBox.getAttribute('data-kind'),'context_overflow');
 assert.equal(errTitle.textContent,'上下文超限');
 assert.match(errDetail.textContent,/壓縮|新對話/);
 assert.equal(errDiag.textContent,'');
});
