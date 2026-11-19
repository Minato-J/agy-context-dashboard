import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const create=createRequire(import.meta.url)('../../../compat/i18n.cjs');

test('all locales have matching translation keys and interpolation parameters',()=>{
  const dictionaries=Function('return ('+create.toString().replace('let language=', 'return dictionary; let language=')+')')()();
  const keys=Object.keys(dictionaries.en).sort();
  const parameters=text=>[...text.matchAll(/\{(\w+)\}/g)].map(x=>x[1]).sort();
  for(const locale of ['zh-CN','zh-TW']){
    assert.deepEqual(Object.keys(dictionaries[locale]).sort(),keys);
    for(const key of keys)assert.deepEqual(parameters(dictionaries[locale][key]),parameters(dictionaries.en[key]),locale+':'+key);
  }
});

test('Traditional locale has safe error fallback, valid remembered toggle and UTC+8 display',()=>{
  const language=create('zh-TW');
  assert.equal(language.errorMessage('未知错误'),language.t('panelUnavailable'));
  assert.equal(language.t('not-a-translation-key'),'not-a-translation-key');
  assert.equal(language.resetDate('2026-10-06T17:15:00Z'),new Intl.DateTimeFormat('zh-TW',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false,timeZone:'Asia/Shanghai'}).format(new Date('2026-10-06T17:15:00Z')));
  language.setLanguage('invalid');assert.equal(language.language,'en');assert.equal(language.toggle(),'zh-TW');
});

test('English is the first-use default, regardless of browser/host language',()=>{
  for(const initial of [undefined,null,'','zh','fr']){
    const language=create(initial);assert.equal(language.language,'en');assert.equal(language.t('cacheTitle'),'Token usage');
  }
});
test('saved Chinese selection is restored and toggling translates text and countdowns immediately',()=>{
  const language=create('zh-CN'),now=Date.parse('2026-10-06T08:00:00Z');
  assert.equal(language.t('cacheTitle'),'Token 用量');
  assert.equal(language.countdown('2026-10-08T10:00:00Z',now),'2d 2h 0m');
  const saved=language.toggle();assert.equal(saved,'en');assert.equal(create(saved).t('cacheTitle'),'Token usage');
  assert.equal(language.countdown('2026-10-08T10:00:00Z',now),'2d 2h 0m');
  assert.equal(language.countdown('2026-10-06T09:05:30Z',now),'1h 5m');
  assert.equal(language.countdown('2026-10-06T08:45:00Z',now),'45m');
  assert.equal(language.countdown('2026-10-06T08:00:30Z',now),'<1m');
  assert.equal(language.t('sample',{rounds:2,steps:6,requests:3}),'2 turns · 6 steps · 3 samples');
  language.toggle();assert.equal(language.t('sample',{rounds:2,steps:6,requests:3}),'2轮 6步 · 3 次采样');
});
test('expired resets do not imply refilled quota in either language',()=>{
  const language=create();const now=Date.parse('2026-10-06T08:00:00Z');
  assert.equal(language.countdown('2026-10-06T08:00:00Z',now),'Waiting for refresh');
  language.toggle();assert.equal(language.countdown('2026-10-06T08:00:00Z',now),'等待刷新');
  assert.equal(language.countdown(null,now),'—');
});
test('English errors do not leak untranslated Chinese backend messages',()=>{
  const language=create();assert.equal(language.errorMessage('请先打开 Antigravity'),'Open Antigravity to connect.');
  assert.equal(language.errorMessage('Antigravity 接口 GetUserStatus 返回 401'),'Antigravity GetUserStatus returned HTTP 401.');
  assert.equal(language.errorMessage('未知错误'),'Statistics are temporarily unavailable.');
  language.toggle();assert.equal(language.errorMessage('请先打开 Antigravity'),'请先打开 Antigravity');
  assert.equal(language.errorMessage('Waiting to reconnect'),'等待控件重新连接');
});
test('Traditional Chinese (zh-TW) provides accurate localized terminology and toggle support',()=>{
  const language=create('zh-TW'),now=Date.parse('2026-10-06T08:00:00Z');
  assert.equal(language.language,'zh-TW');
  assert.equal(language.t('cache'),'快取命中');
  assert.equal(language.t('cacheRate'),'快取命中率');
  assert.equal(language.t('cacheMiss'),'未快取輸入');
  assert.equal(language.t('panelSpeed'),'速率');
  assert.equal(language.t('panelCache'),'快取');
  assert.equal(language.t('panelSharedQuota'),'配額');
  assert.equal(language.t('argonWeek'),'Argon 每週配額');
  assert.equal(language.t('sample',{rounds:2,steps:6,requests:3}),'2 輪 6 步 · 3 次取樣');
  assert.equal(language.countdown('2026-10-08T10:00:00Z',now),'2d 2h 0m');
  assert.equal(language.elapsed(90),'1 分 30 秒');
  assert.equal(language.errorMessage('请先打开 Antigravity'),'請先開啟 Antigravity');
  assert.equal(language.errorMessage('未找到 Antigravity 桌面后台'),'找不到 Antigravity 桌面背景程式');
  assert.equal(language.errorMessage('会话统计数据超过内存预算'),'對話統計資料超出記憶體預算');
  assert.equal(language.errorMessage('Antigravity 接口 GetUserStatus 返回 401'),'Antigravity API GetUserStatus 回傳 HTTP 401');
  const saved=language.toggle();assert.equal(saved,'en');
  assert.equal(language.toggle(),'zh-TW');
});

test('requestError formatting covers all 7 kinds across locales, retryAfter rules, and non-visible filtering',()=>{
  const kinds=['quota_exhausted','rate_limited','network_error','auth_error','service_unavailable','context_overflow','unknown'];
  for(const locale of ['en','zh-CN','zh-TW']){
    const ui=create(locale);
    for(const kind of kinds){
      const formatted=ui.formatRequestError({kind,retryAfterSec:null,diagnostic:'  <script>alert(1)</script>  '});
      assert.ok(formatted,`${locale}:${kind}`);
      assert.equal(formatted.kind,kind);
      assert.ok(formatted.title && !formatted.title.startsWith('requestError_'),`${locale}:${kind} title`);
      assert.ok(formatted.detail && !formatted.detail.startsWith('requestErrorDetail_'),`${locale}:${kind} detail`);
      assert.ok(formatted.badge.includes(formatted.title),`${locale}:${kind} badge includes title`);
      assert.equal(formatted.diagnostic,'<script>alert(1)</script>');
      assert.equal(formatted.retryAfterSec,null);
    }
    const rl=ui.formatRequestError({kind:'rate_limited',retryAfterSec:12.2,diagnostic:'429'});
    assert.equal(rl.retryAfterSec,13);
    assert.match(rl.detail,/13s/);
    const subSecond=ui.formatRequestError({kind:'rate_limited',retryAfterSec:0.2,diagnostic:'429'});
    assert.equal(subSecond.retryAfterSec,1);
    assert.match(subSecond.detail,/1s/);
    for(const bad of [null,0,-5,NaN,'30']){
      const ignored=ui.formatRequestError({kind:'rate_limited',retryAfterSec:bad,diagnostic:'429'});
      assert.equal(ignored.retryAfterSec,null);
      assert.doesNotMatch(ignored.detail,/\ds/);
    }
    const nonRateLimited=ui.formatRequestError({kind:'quota_exhausted',retryAfterSec:30,diagnostic:'quota'});
    assert.equal(nonRateLimited.retryAfterSec,null);
    assert.doesNotMatch(nonRateLimited.detail,/30s/);
    const fallback=ui.formatRequestError({kind:'unrecognized_future_kind',retryAfterSec:null,diagnostic:'boom'});
    assert.equal(fallback.kind,'unknown');
    assert.equal(fallback.title,ui.t('requestError_unknown'));
    for(const hidden of [null,undefined,'',{kind:'none'},{kind:'canceled'},{kind:''}]){
      assert.equal(ui.formatRequestError(hidden),null);
    }
  }
  const zhCN=create('zh-CN');
  assert.equal(zhCN.formatRequestError({kind:'context_overflow',retryAfterSec:null,diagnostic:''}).title,'上下文超限');
  assert.match(zhCN.formatRequestError({kind:'context_overflow',retryAfterSec:null,diagnostic:''}).detail,/压缩|新对话/);
  const zhTW=create('zh-TW');
  assert.equal(zhTW.formatRequestError({kind:'quota_exhausted',retryAfterSec:null,diagnostic:''}).title,'配額耗盡');
  assert.equal(zhTW.formatRequestError({kind:'context_overflow',retryAfterSec:null,diagnostic:''}).title,'上下文超限');
});
