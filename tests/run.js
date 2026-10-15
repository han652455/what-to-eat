/*
 * 今天吃什么 · 自动化验收测试（v2 结构）
 * 运行：NODE_PATH=<托管 node_modules> node tests/run.js [PHASE]
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const HTML_PATH = path.resolve(__dirname, '../index.html');
const html = fs.readFileSync(HTML_PATH, 'utf8');

const THEME_IDS = ['red', 'pink', 'blue', 'ocean', 'cream', 'navy'];
const STORAGE_KEY = 'w2e_v3';

function boot(preset) {
  return new Promise((resolve) => {
    const errs = [];
    const dom = new JSDOM(html, {
      runScripts: 'dangerously',
      pretendToBeVisual: true,
      url: 'http://localhost/',
      beforeParse(w) {
        w.confirm = () => (w.__confirm !== undefined ? w.__confirm : true);
        w.__confirm = true;
        w.matchMedia = (q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} });
        w.scrollTo = () => {};
        w.onerror = (m) => errs.push('ONERROR: ' + m);
        w.addEventListener('error', (e) => errs.push('ERR: ' + (e.message || e.error)));
        if (preset) for (const k in preset) w.localStorage.setItem(k, preset[k]);
      }
    });
    const w = dom.window, d = w.document;
    const ready = () => {
      const ctx = {
        w, d, errs,
        $(s) { return d.querySelector(s); },
        $$(s) { return [...d.querySelectorAll(s)]; },
        click(el) { if (!el) { errs.push('missing element for click'); return; } el.dispatchEvent(new w.MouseEvent('click', { bubbles: true })); },
        act(a) { ctx.click(d.querySelector('[data-act="' + a + '"]')); },
        byAct(a, v) { return d.querySelector('[data-act="' + a + '"' + (v !== undefined ? '][data-v="' + v + '"' : '') + ']'); },
        setVal(id, v) { const el = d.getElementById(id); if (!el) { errs.push('no #' + id); return null; } el.value = v; return el; },
        change(el) { if (el) el.dispatchEvent(new w.Event('change', { bubbles: true })); },
        input(el) { if (el) el.dispatchEvent(new w.Event('input', { bubbles: true })); },
        state() { const r = w.localStorage.getItem(STORAGE_KEY); return r ? JSON.parse(r) : null; },
        setConfirm(b) { w.__confirm = b; },
        setSystemDark(b) { w.matchMedia = (q) => ({ matches: !!b && /dark/.test(q), media: q, addEventListener() {}, removeEventListener() {} }); },
        goTab(id) { ctx.click(d.querySelector('#tabs button[data-v="' + id + '"]')); },
        goView(v) { ctx.click(ctx.byAct('go', v)); },
        go(v) { if (v === 'set') ctx.click(d.querySelector('#setBtn')); else ctx.click(ctx.byAct('go', v)); }
      };
      resolve(ctx);
    };
    if (d.readyState === 'complete') setTimeout(ready, 60);
    else w.addEventListener('load', () => setTimeout(ready, 60));
  });
}

/* 通过 UI 播种数据 */
async function seedMain(ctx, names) {
  ctx.goTab('cook');
  ctx.click(ctx.$('[data-act="openCat"][data-cat="荤菜"]'));
  ctx.setVal('ckbatch', names.join('\n'));
  ctx.act('ckBatchAdd');
}
async function seedBrk(ctx, names) {
  ctx.goTab('gen');
  ctx.goView('gbrk');
  ctx.goView('brkman');
  ctx.setVal('bbatch', names.join('\n'));
  ctx.act('brkBatch');
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assert failed'); }

/* ============ 测试注册 ============ */
const tests = [];
function t(phase, name, fn) { tests.push({ phase, name, fn }); }

/* ---------- 模型契约（保留项） ---------- */
t('MODEL', '数据模型用 ex 而非 excluded', async (c) => {
  await seedMain(c, ['红烧肉', '清炒白菜', '番茄蛋汤']);
  const s = c.state();
  assert(s && s.main.length === 3, 'main 应有 3 条, got ' + (s && s.main.length));
  assert(s.main.every(x => 'ex' in x), '每条都应含 ex 字段');
  assert(s.main.every(x => !('excluded' in x)), '不应存在 excluded 字段');
});
t('MODEL', 'cfg 含 mode(light/dark/auto) 而非 appearance/system', async (c) => {
  await seedMain(c, ['红烧肉']);
  const s = c.state();
  assert(s.cfg && s.cfg.mode, 'cfg.mode 应存在');
  assert(['light', 'dark', 'auto'].includes(s.cfg.mode), 'mode 应为 light/dark/auto');
  assert(!('appearance' in s.cfg), '不应存在 appearance 字段');
});
t('MODEL', '存储键为 w2e_v3，背景图按主题键 w2e_bg_<id>', async (c) => {
  await seedMain(c, ['红烧肉']);
  assert(c.w.localStorage.getItem('w2e_v3') !== null, '应有 w2e_v3');
  for (const id of THEME_IDS) {
    const base = { main: [], brk: [], hist: [], cfg: { theme: id, mode: 'auto', forceOn: true, force: [], bProbs: { out: 0, takeout: 0, snack: 0, skip: 0 }, mProbs: { out: 0, takeout: 0, light: 0, skip: 0 }, bgOpacity: 1 } };
    const pc = await boot({ ['w2e_bg_' + id]: 'data:image/jpeg;base64,xxx', 'w2e_v3': JSON.stringify(base) });
    assert(pc.w.document.body.classList.contains('hasbg'), '主题 ' + id + ' 有背景时应加 hasbg');
  }
});
t('MODEL', '旧 outProb 自动迁移为 bProbs.out', async () => {
  const preset = { 'w2e_v3': JSON.stringify({ main: [], brk: [], hist: [], cfg: { theme: 'red', mode: 'auto', forceOn: true, force: ['豆浆'], outProb: 25 } }) };
  const pc = await boot(preset);
  const s = pc.state();
  assert(s.cfg.bProbs && s.cfg.bProbs.out === 25, 'bProbs.out 应为 25, got ' + (s.cfg.bProbs && s.cfg.bProbs.out));
});

/* ---------- A. 正餐菜谱两层 ---------- */
t('A', '首页显示 6 个分类卡片', async (c) => {
  c.goTab('cook');
  const cards = c.$$('#cookResults .catcard');
  assert(cards.length === 6, '应有 6 个分类卡片, got ' + cards.length);
});
t('A', '点击分类卡片进入二级页（含横向标签）', async (c) => {
  c.goTab('cook');
  c.click(c.$('[data-act="openCat"][data-cat="荤菜"]'));
  assert(c.$('#v-cookcat').classList.contains('on'), 'cookcat 应显示');
  const tabs = c.$$('#v-cookcat .floatbar .hscroll .pill');
  assert(tabs.length === 6, '二级页应有 6 个横向标签, got ' + tabs.length);
});
t('A', '首页跨分类搜索命中并点开弹窗编辑', async (c) => {
  await seedMain(c, ['红烧肉', '清炒白菜', '番茄蛋汤']);
  c.goTab('cook');
  c.setVal('cookSearch', '红烧');
  c.input(c.$('#cookSearch'));
  const res = c.$$('#cookResults .ritem');
  assert(res.length === 1 && res[0].innerHTML.includes('红烧肉'), '搜索应命中红烧肉');
  c.click(res[0]);
  assert(c.$('#sheet').classList.contains('on'), '应打开编辑弹窗');
  assert(!!c.$('#dName') && !!c.$('#dCat'), '弹窗应有菜名与分类');
});
t('A', '二级页批量导入到当前分类', async (c) => {
  c.goTab('cook');
  c.click(c.$('[data-act="openCat"][data-cat="素菜"]'));
  c.setVal('ckbatch', '黄瓜\n茄子');
  c.act('ckBatchAdd');
  const s = c.state();
  assert(s.main.filter(x => x.cat === '素菜').length === 2, '素菜应有 2 道, got ' + s.main.filter(x => x.cat === '素菜').length);
});
t('A', '二级页单条新增 / 批量删除 / 临时排除', async (c) => {
  c.goTab('cook');
  c.click(c.$('[data-act="openCat"][data-cat="荤菜"]'));
  c.setVal('ckbatch', '排骨\n牛肉');
  c.act('ckBatchAdd');
  c.act('exMode');
  c.click(c.$('#v-cookcat .ritem .nm'));
  assert(c.state().main.filter(x => x.ex).length === 1, '应临时排除 1 道');
  c.act('exMode');
  c.act('selAllCat');
  c.setConfirm(true);
  c.act('bulkDel');
  assert(c.state().main.filter(x => x.cat === '荤菜').length === 0, '荤菜应删空');
});
t('A', '二级页弹窗改菜名与分类', async (c) => {
  await seedMain(c, ['宫保鸡丁']);
  c.goTab('cook');
  c.click(c.$('[data-act="openCat"][data-cat="荤菜"]'));
  c.click(c.$('#v-cookcat .ritem [data-act="editDish"]'));
  c.setVal('dName', '宫保鸡丁（微辣）');
  c.change(c.$('#dCat'));
  c.act('saveDish');
  const s = c.state();
  assert(s.main.some(x => x.name === '宫保鸡丁（微辣）'), '菜名应更新');
});

/* ---------- B. 早餐两层 ---------- */
t('B', '早餐首页含生成+4条特殊事件滑块+管理入口', async (c) => {
  c.goTab('gen');
  c.goView('gbrk');
  assert(c.$('#v-gbrk').classList.contains('on'), 'gbrk 应显示');
  const sliders = c.$$('#v-gbrk [data-prob="bProbs"]');
  assert(sliders.length === 4, '应有 4 条 bProbs 滑块, got ' + sliders.length);
  assert(!!c.byAct('go', 'brkman'), '应有管理食材入口');
});
t('B', '早餐二级管理页可批量导入/删除/排除', async (c) => {
  await seedBrk(c, ['包子', '小米粥', '油条']);
  c.goTab('gen'); c.goView('gbrk'); c.goView('brkman');
  assert(c.$('#v-brkman').classList.contains('on'), 'brkman 应显示');
  assert(c.$$('#v-brkman .ritem').length === 3, '应有 3 样, got ' + c.$$('#v-brkman .ritem').length);
  c.act('brkExMode');
  c.click(c.$('#v-brkman .ritem .nm'));
  assert(c.state().brk.filter(x => x.ex).length === 1, '应排除 1 样');
  c.act('brkExMode');
  c.act('brkSelAll');
  c.setConfirm(true);
  c.act('brkBulkDel');
  assert(c.state().brk.length === 0, '早餐应删空');
});
t('B', '强制项可增删', async (c) => {
  c.goTab('gen'); c.goView('gbrk');
  c.setVal('forceNew', '牛奶');
  c.act('forceAdd');
  assert(c.state().cfg.force.includes('牛奶'), '应新增强制项牛奶');
  const before = c.state().cfg.force.length;
  c.click(c.$('#v-gbrk .chip b'));
  assert(c.state().cfg.force.length === before - 1, '应删除一个强制项');
});

/* ---------- C. 正餐专属设置（4滑块+状态） ---------- */
t('C', '正餐生成页含 4 条 mProbs 滑块', async (c) => {
  c.goTab('gen'); c.goView('gmain');
  const sliders = c.$$('#v-gmain [data-prob="mProbs"]');
  assert(sliders.length === 4, '应有 4 条 mProbs 滑块, got ' + sliders.length);
});
t('C', '调节 mProbs 滑块持久化到 cfg', async (c) => {
  c.goTab('gen'); c.goView('gmain');
  const sl = c.$('#v-gmain [data-prob="mProbs"][data-pk="out"]');
  sl.value = '40'; c.input(sl);
  assert(c.state().cfg.mProbs.out === 40, 'mProbs.out 应为 40, got ' + c.state().cfg.mProbs.out);
});
t('C', '正餐命中外出概率→状态 out 并入库', async () => {
  const preset = { 'w2e_v3': JSON.stringify({ main: [{ id: 'a', name: '红烧肉', cat: '荤菜', ex: false }], brk: [], hist: [], cfg: { theme: 'red', mode: 'auto', forceOn: true, force: [], bProbs: { out: 0, takeout: 0, snack: 0, skip: 0 }, mProbs: { out: 100, takeout: 0, light: 0, skip: 0 }, bgOpacity: 1 } }) };
  const pc = await boot(preset);
  pc.goTab('gen'); pc.goView('gmain');
  pc.act('genMain');
  const s = pc.state();
  assert(s.hist[0].state === 'out', '首条历史 state 应为 out, got ' + s.hist[0].state);
  assert(s.hist[0].items.length === 0, 'out 状态不应有菜品');
});
t('C', '正餐命中简餐→1 道菜轻食', async () => {
  const preset = { 'w2e_v3': JSON.stringify({ main: [{ id: 'a', name: '红烧肉', cat: '荤菜', ex: false }, { id: 'b', name: '清炒白菜', cat: '素菜', ex: false }], brk: [], hist: [], cfg: { theme: 'red', mode: 'auto', forceOn: true, force: [], bProbs: { out: 0, takeout: 0, snack: 0, skip: 0 }, mProbs: { out: 0, takeout: 0, light: 100, skip: 0 }, bgOpacity: 1 } }) };
  const pc = await boot(preset);
  pc.goTab('gen'); pc.goView('gmain');
  pc.act('genMain');
  const s = pc.state();
  assert(s.hist[0].state === 'light', 'state 应为 light');
  assert(s.hist[0].items.length === 1, '简餐应有 1 道, got ' + s.hist[0].items.length);
});
t('C', '正餐正常生成（概率全 0）出菜品', async () => {
  const preset = { 'w2e_v3': JSON.stringify({ main: [{ id: 'a', name: '红烧肉', cat: '荤菜', ex: false }], brk: [], hist: [], cfg: { theme: 'red', mode: 'auto', forceOn: true, force: [], bProbs: { out: 0, takeout: 0, snack: 0, skip: 0 }, mProbs: { out: 0, takeout: 0, light: 0, skip: 0 }, bgOpacity: 1 } }) };
  const pc = await boot(preset);
  pc.goTab('gen'); pc.goView('gmain');
  pc.act('genMain');
  const s = pc.state();
  assert(s.hist[0].state === 'normal' && s.hist[0].items.length >= 1, '正常应出菜品');
});

/* ---------- D. 历史特殊状态 ---------- */
t('D', '早餐命中外出→历史显示外出标记', async () => {
  const preset = { 'w2e_v3': JSON.stringify({ main: [], brk: [{ id: 'x', name: '包子', ex: false }], hist: [], cfg: { theme: 'red', mode: 'auto', forceOn: false, force: [], bProbs: { out: 100, takeout: 0, snack: 0, skip: 0 }, mProbs: { out: 0, takeout: 0, light: 0, skip: 0 }, bgOpacity: 1 } }) };
  const pc = await boot(preset);
  pc.goTab('gen'); pc.goView('gbrk');
  pc.act('genBrk');
  const s = pc.state();
  assert(s.hist[0].state === 'out', '早餐 state 应为 out');
  pc.goTab('hist');
  pc.click(pc.$('#hMode button[data-hm="list"]'));
  assert(pc.$('#v-hist').innerHTML.includes('外出'), '历史应显示外出');
});
t('D', '编辑记录可改特殊状态并保存', async () => {
  const preset = { 'w2e_v3': JSON.stringify({ main: [], brk: [], hist: [{ id: 'h1', type: 'main', ts: Date.now(), items: [{ name: '红烧肉' }], state: 'normal', mode: 'normal' }], cfg: { theme: 'red', mode: 'auto', forceOn: true, force: [], bProbs: { out: 0, takeout: 0, snack: 0, skip: 0 }, mProbs: { out: 0, takeout: 0, light: 0, skip: 0 }, bgOpacity: 1 } }) };
  const pc = await boot(preset);
  pc.goTab('hist');
  pc.click(pc.$('#hMode button[data-hm="list"]'));
  pc.click(pc.$('#v-hist [data-act="editRec"][data-id="h1"]'));
  const sel = pc.$('#eState');
  sel.value = 'skip';
  pc.change(sel);
  pc.act('saveEdit');
  const s = pc.state();
  assert(s.hist[0].state === 'skip', '状态应改为 skip');
  pc.goTab('hist');
  pc.click(pc.$('#hMode button[data-hm="list"]'));
  assert(pc.$('#v-hist').innerHTML.includes('不吃'), '历史应显示不吃');
});
t('D', '早餐专属选项含零食，正餐专属选项含简餐', async (c) => {
  c.goTab('gen'); c.goView('gbrk');
  const labels = c.$$('#v-gbrk [data-prob="bProbs"]').map(s => s.previousElementSibling.textContent);
  assert(labels.some(x => x.indexOf('零食') >= 0), '早餐应有零食');
  c.goView('gmain');
  const ml = c.$$('#v-gmain [data-prob="mProbs"]').map(s => s.previousElementSibling.textContent);
  assert(ml.some(x => x.indexOf('简餐') >= 0), '正餐应有简餐');
});

/* ---------- E. 背景透明度 ---------- */
t('E', '背景图存在时显示透明度滑块，调节持久化', async () => {
  const preset = { 'w2e_bg_red': 'data:image/jpeg;base64,xxx', 'w2e_v3': JSON.stringify({ main: [], brk: [], hist: [], cfg: { theme: 'red', mode: 'auto', forceOn: true, force: [], bProbs: { out: 0, takeout: 0, snack: 0, skip: 0 }, mProbs: { out: 0, takeout: 0, light: 0, skip: 0 }, bgOpacity: 1 } }) };
  const pc = await boot(preset);
  pc.go('set');
  assert(!!pc.$('#bgOp'), '应有透明度滑块');
  pc.setVal('bgOp', '50');
  pc.input(pc.$('#bgOp'));
  assert(Math.round(pc.state().cfg.bgOpacity * 100) === 50, 'bgOpacity 应为 .5');
  assert(pc.w.document.getElementById('bgLayer').style.opacity === '0.5', 'bgLayer opacity 应为 0.5');
});
t('E', '无背景图时不显示透明度滑块', async (c) => {
  c.go('set');
  assert(!c.$('#bgOp'), '无背景时不应有透明度滑块');
});

/* ---------- F. 备份复制修复 ---------- */
t('F', '生成备份文本且复制时全选', async (c) => {
  await seedMain(c, ['红烧肉', '清炒白菜']);
  c.go('set');
  c.act('expGo');
  const b = c.$('#expBox');
  assert(b.value && b.value.includes('TODAY-EAT-BACKUP v3'), '应生成备份文本');
  assert(b.value.includes('红烧肉'), '备份应包含菜品');
  c.act('expCopy');
  assert(b.selectionStart === 0 && b.selectionEnd === b.value.length, '复制前应全选文本 (' + b.selectionStart + ',' + b.selectionEnd + '/' + b.value.length + ')');
});
t('F', '备份导入可恢复', async (c) => {
  await seedMain(c, ['红烧肉']);
  c.go('set');
  c.act('expGo');
  const txt = c.$('#expBox').value;
  c.act('wipe');
  c.setConfirm(true);
  c.setVal('impBox', txt);
  c.setConfirm(true);
  c.act('impGo');
  const s = c.state();
  assert(s.main.some(x => x.name === '红烧肉'), '导入后应恢复红烧肉');
});

/* ---------- G. 维持原样：冰箱/大锅菜/主题/持久化 ---------- */
t('G', '冰箱临时抽取（不入库）', async (c) => {
  c.goTab('gen'); c.goView('gmain');
  c.setVal('fridge', '鸡蛋\n西红柿\n青椒');
  c.setVal('fcnt', '2');
  c.act('fridgeGo');
  const items = c.$$('#fridgeRes .ritem');
  assert(items.length === 2, '应抽到 2 样, got ' + items.length);
  assert(c.state().main.length === 0, '冰箱不应写入正式库');
});
t('G', '大锅菜模式抽一口当整餐', async (c) => {
  c.goTab('cook');
  c.click(c.$('[data-act="openCat"][data-cat="大锅菜"]'));
  c.setVal('ckbatch', '麻辣火锅');
  c.act('ckBatchAdd');
  c.goTab('gen'); c.goView('gmain');
  c.click(c.$('#v-gmain #mMode button[data-m="pot"]'));
  c.act('genMain');
  const s = c.state();
  assert(s.hist[0].mode === 'pot' && s.hist[0].items.length === 1, '大锅菜应 1 道');
});
t('G', '主题切换改变主色 / 暗色对比度', async (c) => {
  c.go('set');
  for (const id of THEME_IDS) {
    c.click(c.$('[data-act="pickTheme"][data-id="' + id + '"]'));
    const bg = c.w.document.documentElement.style.getPropertyValue('--bg');
    assert(bg && bg.length > 0, '主题 ' + id + ' 应设定 --bg');
  }
  c.setSystemDark(true);
  c.click(c.$('#setMode button[data-md="dark"]'));
  const parseColor = (v) => {
    v = (v || '').trim();
    if (v[0] === '#') {
      let h = v.slice(1);
      if (h.length === 3) h = h.split('').map(x => x + x).join('');
      return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
    }
    const m = v.match(/\d+/g);
    if (!m || m.length < 3) return [0, 0, 0];
    return [+m[0], +m[1], +m[2]];
  };
  const lum = (rgb) => (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) / 255;
  const txt = c.w.document.documentElement.style.getPropertyValue('--text');
  const bg = c.w.document.documentElement.style.getPropertyValue('--bg');
  const c1 = lum(parseColor(txt)), c2 = lum(parseColor(bg));
  assert(Math.abs(c1 - c2) > 0.35, '暗色文字/背景对比应足够, got ' + c1.toFixed(2) + ' vs ' + c2.toFixed(2));
});
t('G', '刷新后数据持久化', async (c) => {
  await seedMain(c, ['红烧肉']);
  await seedBrk(c, ['包子']);
  const snap = c.state();
  const c2 = await boot({ 'w2e_v3': JSON.stringify(snap) });
  const s2 = c2.state();
  assert(s2.main.some(x => x.name === '红烧肉'), '刷新后应有红烧肉');
  assert(s2.brk.some(x => x.name === '包子'), '刷新后应有包子');
});

/* ---------- H. 回归：导出头/数据完整性 ---------- */
t('H', '导出文本含全部三套数据', async (c) => {
  await seedMain(c, ['红烧肉']);
  await seedBrk(c, ['包子']);
  c.goTab('gen'); c.goView('gmain'); c.act('genMain');
  c.go('set'); c.act('expGo');
  const v = c.$('#expBox').value;
  const o = JSON.parse(v.slice(v.indexOf('{')));
  assert(o.main.length === 1 && o.brk.length === 1 && o.hist.length >= 1, '导出应含 main/brk/hist');
});

/* ============ 运行器 ============ */
(async () => {
  const phaseFilter = process.argv[2];
  const list = phaseFilter ? tests.filter(x => x.phase === phaseFilter) : tests;
  let pass = 0, fail = 0;
  const fails = [];
  for (const tt of list) {
    const c = await boot();
    try {
      await tt.fn(c);
      if (c.errs.length) throw new Error('运行时错误: ' + c.errs.join(' | '));
      pass++;
      console.log('  ✓ [' + tt.phase + '] ' + tt.name);
    } catch (e) {
      fail++;
      fails.push('  ✗ [' + tt.phase + '] ' + tt.name + ' — ' + e.message);
      console.log('  ✗ [' + tt.phase + '] ' + tt.name + ' — ' + e.message);
    }
  }
  console.log('\n通过 ' + pass + ' / ' + (pass + fail) + (fail ? '，失败 ' + fail : '，全部通过'));
  if (fail) { process.exit(1); }
})();
