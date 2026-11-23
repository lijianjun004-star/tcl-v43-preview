#!/usr/bin/env python3
"""Adversarial browser checks for the isolated R24 Excel QA route (browser-local only).

Added after the independent live review of QA2. Reuses browser_assignment_e2e.Audit
for login/answer/finish mechanics; the scenarios are new: duplicate/empty/category/
platform/oversize Excel gates, two operators and two anchors searching by operator
name, legacy restricted roster, receipt tampering, deadline/late receipts, real-model
noise answers, duplicate package notice and fold indicator rendering.
Every check is recorded; the process exits non-zero if any check fails.
Run against a staged site (local http.server in CI) or the public Pages URL.
"""
import argparse, asyncio, copy, importlib.util, json, sys, traceback, unicodedata
from pathlib import Path
from openpyxl import Workbook

ap = argparse.ArgumentParser()
ap.add_argument('--e2e', default=str(Path(__file__).with_name('browser_assignment_e2e.py'))); ap.add_argument('--base-url', required=True)
ap.add_argument('--evidence', required=True); ap.add_argument('--skip-real-model', action='store_true', help='site has no staged Paraformer model files')
args = ap.parse_args()
spec = importlib.util.spec_from_file_location('e2e', args.e2e); E = importlib.util.module_from_spec(spec); spec.loader.exec_module(E)
from playwright.async_api import async_playwright, expect

QS = [f'复验题{i}：RV-{i} 型号的核心卖点是什么？' for i in range(1, 4)]
ANS = [f'复验回答第{i}题：RV-{i} 仅为合成流程测试。' for i in range(1, 4)]
E.QUESTIONS = QS; E.ANSWERS = ANS
OP_A, OP_B = '复验运营甲', '复验运营乙'
AN_A, AN_B = '复验主播A', '复验主播B'
HDR = ['题目', '参考答案', '型号', 'SKU', '评分要点']


def degenerate(value):
    """Python mirror of assignment-excel.mjs isDegenerateAnswer()."""
    chars = [c for c in unicodedata.normalize('NFKC', value or '') if not (c.isspace() or unicodedata.category(c)[0] in 'PS')]
    d = len(set(chars))
    return (len(chars) >= 4 and d <= 2) or (len(chars) >= 8 and d <= 3)


def xlsx(path, rows, header=HDR):
    wb = Workbook(); ws = wb.active
    ws.append(header)
    for r in rows: ws.append(r)
    wb.save(path); return path


class Live(E.Audit):
    def __init__(self, a):
        super().__init__(a); self.soft = []

    def check(self, name, condition, detail=None):
        row = {'name': name, 'pass': bool(condition), 'detail': detail}
        self.rows.append(row); print(json.dumps(row, ensure_ascii=False), flush=True)

    async def toast(self, p):
        try: return (await p.locator('#toast').inner_text()).strip()
        except Exception: return ''

    async def wait_toast(self, p, text, timeout=8000):
        try:
            await expect(p.locator('#toast')).to_contain_text(text, timeout=timeout); return True
        except Exception: return False

    async def preview(self, op, path, expect_text):
        await op.locator('#assignmentExcelFile').set_input_files(str(path))
        await op.locator('#assignmentExcelPreviewBtn').click()
        try: await expect(op.locator('#assignmentExcelPreview')).to_contain_text(expect_text, timeout=15000)
        except Exception: pass
        return (await op.locator('#assignmentExcelPreview').inner_text()).strip()

    async def publish(self, op, title, path, deadline=''):
        await op.locator('[data-ops-tab="publish"]').click() if await op.locator('[data-ops-tab="publish"]').count() else None
        await op.locator('#assignmentTitle').fill(title)
        await op.locator('#assignmentBoard').select_option('01')
        await op.locator('#assignmentPlatform').select_option('京东')
        if deadline: await op.locator('#assignmentDeadline').fill(deadline)
        txt = await self.preview(op, path, '3 道')
        await op.locator('#publishAssignment').click()
        await expect(op.locator('[data-export-assignment]').first).to_be_visible()
        mine = [a for a in await self.pref(op, 'assignments') if a['title'] == title]
        target, pkg = await self.download(op, lambda: op.locator(f'[data-export-assignment="{mine[0]["id"]}"]').click(), f'pkg-{title}.json')
        return target, pkg, txt

    async def search(self, p, q):
        fold = p.locator('#assignmentFold')
        if await fold.get_attribute('open') is None: await fold.locator('summary').click()
        await p.locator('#assignmentSearch').fill(q)
        await p.wait_for_timeout(400)
        return (await p.locator('#assignmentSearchResults').inner_text()).strip()

    async def complete(self, p, pkg_path, title, name):
        """Import, search by operator, join the matching row, answer all, return receipt."""
        await self.open_import(p, pkg_path)
        await self.search(p, OP_A)
        row = p.locator('#assignmentSearchResults .assignment-row', has_text=title)
        await row.locator('[data-join-assignment]').click()
        await expect(p.locator('#startScene')).to_be_visible()
        if await p.locator('#prepQuickText').is_visible(): await p.locator('#prepQuickText').click()
        await expect(p.locator('#startScene')).to_be_enabled(timeout=30000)
        await p.locator('#startScene').click()
        for i in range(3): await self.answer(p, i)
        await self.next_question(p)
        await self.finish(p)

    async def submit(self, p, fname):
        return await self.download(p, lambda: p.locator('#submitSession').click(), fname)

    async def import_variant(self, op, receipt, label, expect_text):
        path = self.out / f'variant-{label}.json'
        path.write_text(json.dumps(receipt, ensure_ascii=False))
        before = len(await self.pref(op, 'submissions'))
        await op.locator('[data-ops-tab="tracking"]').click()
        await op.locator('#assignmentReceiptImport').set_input_files([])
        await op.locator('#assignmentReceiptImport').set_input_files(str(path))
        ok = await self.wait_toast(op, expect_text)
        after = len(await self.pref(op, 'submissions'))
        return ok, before, after, await self.toast(op)

    async def run(self, browser):
        fx = self.out / 'fx'; fx.mkdir(exist_ok=True)
        good = xlsx(fx / 'good.xlsx', [[q, f'参考答案{i}：合成。', f'RV-{i}', f'00{i}', '卖点；核对'] for i, q in enumerate(QS, 1)])
        good_b = xlsx(fx / 'good_b.xlsx', [[q, f'乙参考{i}：合成。', f'RV-{i}', f'00{i}', '卖点'] for i, q in enumerate(QS, 1)])
        dup = xlsx(fx / 'dup.xlsx', [[QS[0], '答案甲', 'RV-1', '001', ''], [QS[0], '答案乙', 'RV-1', '001', ''], [QS[1], '答案丙', 'RV-2', '002', '']])
        dup_ws = fx / 'dup_ws.xlsx'; wb = Workbook(); s1 = wb.active; s1.append(HDR); s1.append([QS[0], '答案甲', 'RV-1', '001', '']); s2 = wb.create_sheet('第二页'); s2.append(HDR); s2.append([QS[0], '答案乙', 'RV-1', '001', '']); wb.save(dup_ws)
        empty = xlsx(fx / 'empty_answer.xlsx', [[QS[0], '答案甲', 'RV-1', '001', ''], [QS[1], '', 'RV-2', '002', '']])
        cat = xlsx(fx / 'wrong_category.xlsx', [[QS[0], '答案甲', 'RV-1', '001', '', 'TCL 空调']], HDR + ['品类'])
        plat = xlsx(fx / 'wrong_platform.xlsx', [[QS[0], '答案甲', 'RV-1', '001', '', '抖音']], HDR + ['平台'])
        diffmodel = xlsx(fx / 'same_q_diff_model.xlsx', [[QS[0], '答案甲', 'RV-1', '001', ''], [QS[0], '答案乙', 'RV-9', '009', '']])
        over = xlsx(fx / 'over100.xlsx', [[f'超量题目{i}？', '合成答案', f'M{i}', f'{i}', ''] for i in range(101)])

        # ---------- A. Operator Excel gates ----------
        op_ctx = await self.context(browser); op = await self.page(op_ctx)
        await self.login(op, 'operator', OP_A)
        await op.locator('#assignmentTitle').fill('门禁测试'); await op.locator('#assignmentBoard').select_option('01'); await op.locator('#assignmentPlatform').select_option('京东')
        for label, path, want in [('duplicate question+model+SKU rows', dup, '失败'), ('duplicate across worksheets', dup_ws, '失败'),
                                  ('empty reference answer', empty, '失败'), ('category column mismatch (空调 vs 电视)', cat, '失败'),
                                  ('platform column mismatch (抖音 vs 京东)', plat, '失败'), ('more than 100 questions', over, '失败')]:
            t = await self.preview(op, path, want)
            await op.locator('#publishAssignment').click(); await op.wait_for_timeout(300)
            self.check(f'A: {label} blocked & not published', '失败' in t and not await self.pref(op, 'assignments'), t[:160])
        t = await self.preview(op, diffmodel, '2 道')
        self.check('A: same question with different model/SKU allowed in preview', '2 道' in t, t[:160])
        items = await self.db(op, 'items')
        self.check('A: public question store stays empty after all previews', items == [], items)

        # ---------- B. Two operators publish; two anchors search by operator name ----------
        pkg_a_path, pkg_a, _ = await self.publish(op, '甲作业', good)
        self.check('B: published package assignedTo is empty list', pkg_a['assignment']['assignedTo'] == [], pkg_a['assignment']['assignedTo'])
        self.check('B: frozen question order/SKU in package', [q['question'] for q in pkg_a['assignment']['questions']] == QS and [q['sku'] for q in pkg_a['assignment']['questions']] == ['001', '002', '003'])
        items = await self.db(op, 'items'); self.check('B: publish does not write public question store', items == [], items)
        opb_ctx = await self.context(browser); opb = await self.page(opb_ctx); await self.login(opb, 'operator', OP_B)
        pkg_b_path, pkg_b, _ = await self.publish(opb, '乙作业', good_b)

        anchors = {}
        for name in (AN_A, AN_B):
            ctx = await self.context(browser); p = await self.page(ctx); await self.login(p, 'anchor', name)
            r0 = await self.search(p, OP_A)
            self.check(f'B[{name}]: before importing JSON nothing is discoverable', '甲作业' not in r0, r0[:120])
            await self.open_import(p, pkg_a_path); await self.wait_toast(p, '已导入')
            await self.open_import(p, pkg_b_path); await self.wait_toast(p, '已导入')
            ra = await self.search(p, OP_A); rb = await self.search(p, OP_B); rp = await self.search(p, '甲'); rn = await self.search(p, '不存在的运营')
            self.check(f'B[{name}]: search full operator name 甲 returns only 甲作业', '甲作业' in ra and '乙作业' not in ra, ra[:160])
            self.check(f'B[{name}]: search operator 乙 returns only 乙作业', '乙作业' in rb and '甲作业' not in rb, rb[:160])
            self.check(f'B[{name}]: partial operator name search works', '甲作业' in rp, rp[:160])
            self.check(f'B[{name}]: unknown operator returns empty state', '甲作业' not in rn and '乙作业' not in rn, rn[:160])
            anchors[name] = (ctx, p)

        # ---------- C. Legacy restricted roster ----------
        ctxc = await self.context(browser); pc = await self.page(ctxc); await self.login(pc, 'anchor', '名单外主播')
        restricted = await pc.evaluate("""async (q) => {
          const m = await import(new URL('assignment-excel.mjs', location.href).href);
          const a = await m.makeAssignment({id:'legacy-roster-check', title:'历史名单作业', operatorName:'复验运营甲', boardId:'01', platform:'京东', assignedTo:['指定主播'], questions:q});
          const pkg = m.toExchangePackage(a);
          const dropped = structuredClone(pkg); dropped.assignment.assignedTo = [];
          return {pkg, dropped};
        }""", [{'question': q, 'answer': f'参考答案{i}', 'model': f'RV-{i}', 'sku': f'00{i}', 'category': 'TCL 电视', 'platform': '京东', 'keyPoints': []} for i, q in enumerate(QS, 1)])
        rp_ = fx / 'restricted.json'; rp_.write_text(json.dumps(restricted['pkg'], ensure_ascii=False))
        dp_ = fx / 'restricted_dropped.json'; dp_.write_text(json.dumps(restricted['dropped'], ensure_ascii=False))
        await self.open_import(pc, rp_); ok = await self.wait_toast(pc, '导入失败')
        self.check('C: non-roster anchor cannot import a legacy restricted package', ok and not await self.pref(pc, 'assignments'), await self.toast(pc))
        await pc.locator('#assignmentPackageImport').set_input_files([]); await self.open_import(pc, dp_); ok = await self.wait_toast(pc, '导入失败')
        self.check('C: dropping roster without rehash is rejected (hash covers assignedTo)', ok and not await self.pref(pc, 'assignments'), await self.toast(pc))
        ctxd = await self.context(browser); pd = await self.page(ctxd); await self.login(pd, 'anchor', '指定主播')
        await self.open_import(pd, rp_); ok = await self.wait_toast(pd, '已导入')
        self.check('C: roster anchor can import the restricted package', ok and len(await self.pref(pd, 'assignments')) == 1, await self.toast(pd))
        await ctxc.close(); await ctxd.close()

        # ---------- D. Two anchors complete and operator imports; tampering ----------
        receipts = {}
        for name, (ctx, p) in anchors.items():
            await self.complete(p, pkg_a_path, '甲作业', name)
            path, rec = await self.submit(p, f'receipt-{name}.json'); receipts[name] = (path, rec)
            self.check(f'D[{name}]: receipt carries own anchor name and exact order', rec['anchorName'] == name and [t['question'] for t in rec['turns']] == QS)
        base = receipts[AN_A][1]
        variants = []
        v = copy.deepcopy(base); v['turns'][1]['sku'] = '999'; variants.append(('sku-changed', v, '不一致'))
        v = copy.deepcopy(base); v['turns'][1]['model'] = 'RV-X'; variants.append(('model-changed', v, '不一致'))
        v = copy.deepcopy(base); v['turns'][0]['question'] += '（改）'; variants.append(('question-text-changed', v, '不一致'))
        v = copy.deepcopy(base); v['turns'].reverse(); variants.append(('turns-reordered', v, '不匹配'))
        v = copy.deepcopy(base); v['turns'].pop(); variants.append(('turn-missing', v, '全部题目'))
        v = copy.deepcopy(base); v['turns'][2] = copy.deepcopy(v['turns'][1]); variants.append(('turn-duplicated', v, '不匹配'))
        v = copy.deepcopy(base); v['turns'][1]['answer'] = '   '; variants.append(('empty-answer', v, '尚未完成'))
        v = copy.deepcopy(base); v['snapshotSha256'] = 'f' * 64; variants.append(('snapshot-hash-changed', v, '版本不一致'))
        v = copy.deepcopy(base); v['boardId'] = '02'; variants.append(('board-changed', v, '不匹配'))
        v = copy.deepcopy(base); v['warning'] = '已认证'; variants.append(('warning-removed', v, '人工核实'))
        v = copy.deepcopy(base); v['extra'] = 1; variants.append(('extra-field', v, '失败'))
        v = copy.deepcopy(receipts[AN_A][1]); v['assignmentId'] = pkg_b['assignment']['id']; v['snapshotSha256'] = pkg_b['assignment']['snapshotSha256']; v['operatorName'] = OP_B
        variants.append(('other-operator-assignment', v, '未找到本人'))
        for label, rec, want in variants:
            ok, b, a, msg = await self.import_variant(op, rec, label, want)
            self.check(f'D: tampered receipt rejected [{label}]', ok and a == b == 0, {'toast': msg, 'before': b, 'after': a})
        for name in (AN_A, AN_B):
            ok, b, a, msg = await self.import_variant(op, receipts[name][1], 'valid-' + name, '回执已导入')
            self.check(f'D: valid receipt from {name} imported', ok and a == b + 1, msg)
        txt = await op.locator('#ops-tracking').inner_text()
        self.check('D: operator tracking shows both anchors as 回执待核实', f'{AN_A} · 回执待核实' in txt and f'{AN_B} · 回执待核实' in txt, txt[:400])
        v = copy.deepcopy(base); v['turns'][0]['answer'] += '改'; ok, b, a, msg = await self.import_variant(op, v, 'conflict', '冲突')
        self.check('D: conflicting same-session receipt rejected', ok and a == b, msg)
        forged = copy.deepcopy(base); forged['anchorName'] = '从未练习的人'
        ok, b, a, msg = await self.import_variant(op, forged, 'forged-name', '回执已导入')
        self.check('D(INFO): renamed copy of a receipt is accepted for public job (names are not auth)', ok and a == b + 1, msg)
        # operator B must not accept A's receipt
        await opb.locator('[data-ops-tab="tracking"]').click()
        pth = self.out / 'cross-op.json'; pth.write_text(json.dumps(base, ensure_ascii=False))
        await opb.locator('#assignmentReceiptImport').set_input_files(str(pth))
        ok = await self.wait_toast(opb, '未找到本人')
        self.check('D: another operator cannot import receipt of 甲作业', ok and not await self.pref(opb, 'submissions'), await self.toast(opb))

        # ---------- E. Deadline / late submission ----------
        now = await op.evaluate('Date.now()')
        dl_local = await op.evaluate("(ms)=>{const d=new Date(ms);const p=n=>String(n).padStart(2,'0');return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`}", now + 120000)
        pkg_l_path, pkg_l, _ = await self.publish(op, '限时作业', good, deadline=dl_local)
        self.check('E: deadline saved in package', bool(pkg_l['assignment']['deadline']), pkg_l['assignment']['deadline'])
        ctx = await self.context(browser); p = await self.page(ctx); await self.login(p, 'anchor', '限时主播')
        # join before the deadline
        await self.open_import(p, pkg_l_path); await self.wait_toast(p, '已导入')
        await self.search(p, OP_A)
        row = p.locator('#assignmentSearchResults .assignment-row', has_text='限时作业')
        await row.locator('[data-join-assignment]').click()
        await expect(p.locator('#startScene')).to_be_visible()
        if await p.locator('#prepQuickText').is_visible(): await p.locator('#prepQuickText').click()
        await expect(p.locator('#startScene')).to_be_enabled(timeout=30000)
        await p.locator('#startScene').click()
        for i in range(3): await self.answer(p, i)
        await self.next_question(p)
        deadline_ms = await p.evaluate('(s)=>new Date(s).getTime()', pkg_l['assignment']['deadline'])
        while await p.evaluate('Date.now()') <= deadline_ms + 2000: await asyncio.sleep(5)
        await self.finish(p)
        lp, lrec = await self.submit(p, 'receipt-late.json')
        local = [s for s in await self.pref(p, 'submissions') if s.get('assignmentId') == pkg_l['assignment']['id']]
        self.check('E: anchor-local submission after deadline flagged late', bool(local) and local[0].get('late') is True, local[0].get('late') if local else None)
        self.check('E: receipt submittedAt is after deadline', lrec['submittedAt'] > pkg_l['assignment']['deadline'], [lrec['submittedAt'], pkg_l['assignment']['deadline']])
        ok, b, a, msg = await self.import_variant(op, lrec, 'late', '逾期提交')
        txt = await op.locator('#ops-tracking').inner_text()
        seg = txt[txt.find('限时作业'):][:300]
        self.check('E: operator view marks late manual receipt as 逾期', '限时主播 · 逾期提交 · 回执待核实' in seg, seg)
        self.check('E: late import notice mentions device-clock lateness', ok and '逾期提交' in msg, msg)
        # new anchor cannot join after deadline
        ctxl = await self.context(browser); pl = await self.page(ctxl); await self.login(pl, 'anchor', '迟到主播')
        await self.open_import(pl, pkg_l_path); await self.wait_toast(pl, '已导入')
        await self.search(pl, OP_A)
        rowl = pl.locator('#assignmentSearchResults .assignment-row', has_text='限时作业')
        btn = rowl.locator('[data-join-assignment]')
        if await btn.count() and not await btn.is_disabled():
            await btn.click(); blocked = await self.wait_toast(pl, '已截止')
        else: blocked = True
        self.check('E: new anchor cannot join after deadline', blocked, {'toast': await self.toast(pl), 'row': (await rowl.inner_text())[:160] if await rowl.count() else None})

        # ---------- G. Duplicate package notice and fold indicator ----------
        ctxg = await self.context(browser); pg = await self.page(ctxg); await self.login(pg, 'anchor', '界面主播')
        await self.open_import(pg, pkg_a_path); first = await self.wait_toast(pg, '作业包已导入本机')
        await self.open_import(pg, pkg_a_path); again = await self.wait_toast(pg, '该作业已在本机列表中')
        self.check('G: re-importing the same package says it already exists, one copy kept', first and again and len(await self.pref(pg, 'assignments')) == 1, await self.toast(pg))
        fold = pg.locator('#logFold')
        closed = await fold.locator('.fold-indicator').evaluate("e=>({text:e.textContent,transform:getComputedStyle(e).transform})")
        await fold.locator('summary').click(); await pg.wait_for_timeout(300)
        opened = await fold.locator('.fold-indicator').evaluate("e=>{const r=e.getBoundingClientRect();return {text:e.textContent,transform:getComputedStyle(e).transform,w:r.width,h:r.height}}")
        self.check('G: open fold indicator is upright and labelled 收起', closed['text'] == '展开 ›' and opened['text'] == '收起 ⌄' and opened['transform'] == 'none' and opened['w'] > opened['h'], {'closed': closed, 'opened': opened})
        await self.screenshot(pg, 'fold-open'); await ctxg.close()

        # ---------- H. Real Paraformer on a non-speech microphone ----------
        if not self.args.skip_real_model:
            ctxn = await self.context(browser, mock_asr=False); pn = await self.page(ctxn)
            self.page_labels[pn] = 'real-model-noise'; self.phase = 'real-model-noise'
            await self.login(pn, 'anchor', '噪声主播'); await self.open_import(pn, pkg_a_path); await self.wait_toast(pn, '已导入')
            await self.search(pn, OP_A)
            await pn.locator('#assignmentSearchResults .assignment-row', has_text='甲作业').locator('[data-join-assignment]').click()
            await expect(pn.locator('#startScene')).to_be_visible(); await pn.locator('#prepQuickRecheck').click()
            await expect(pn.locator('#startScene')).to_be_enabled(timeout=30000); await pn.locator('#startScene').click()
            for i in range(3):
                await expect(pn.locator('#liveQText')).to_have_text(QS[i]); await pn.wait_for_timeout(3500)
                if i < 2: await self.next_question(pn)
            await self.next_question(pn); await self.finish(pn)
            await pn.wait_for_timeout(75000)  # real model load + per-question inference
            await pn.locator('#reviewDetails').click()
            eds = pn.locator('textarea[aria-label="编辑本题回答"]')
            asr = [await eds.nth(i).input_value() for i in range(await eds.count())]
            await pn.locator('#reviewDetailsBack').click()
            got = None
            try:
                async with pn.expect_download(timeout=8000) as info: await pn.locator('#submitSession').click()
                got = json.loads(Path(await (await info.value).path()).read_text())
            except Exception: pass
            toast = await self.toast(pn)
            bad = [a for a in asr if degenerate(a)]
            self.check('H: noise-only answers cannot be submitted as a complete receipt',
                       (got is None and ('疑似噪音' in toast or '尚未完成' in toast)) or (got is not None and not any(degenerate(t['answer']) for t in got['turns']) and all(t['answer'].strip() for t in got['turns'])),
                       {'asr_answers': asr, 'degenerate': bad, 'toast': toast, 'receipt': bool(got)})
            if bad: self.check('H: degenerate ASR text names the noise rule', '疑似噪音' in toast or '尚未完成' in toast, toast)
            if got is None:
                await pn.locator('#reviewDetails').click()
                for i in range(await eds.count()):
                    await eds.nth(i).fill(ANS[i]); await pn.get_by_role('button', name='保存本题修改', exact=True).nth(i).click()
                await pn.locator('#reviewDetailsBack').click()
                _, fixed = await self.submit(pn, 'receipt-after-noise-fix.json')
                self.check('H: after manual correction the receipt carries the corrected answers', [t['answer'] for t in fixed['turns']] == ANS, [t['answer'] for t in fixed['turns']])
            await self.screenshot(pn, 'real-model-noise'); await ctxn.close()

        # ---------- F. Isolation / hygiene ----------
        host = self.base.split('/')[2]
        ext = [r for r in self.requests if r['url'].startswith('http') and r['url'].split('/')[2] != host]
        self.check('F: no third-party requests', not ext, ext[:5])
        self.check('F: no non-GET requests', not [r for r in self.requests if r['method'] not in ('GET', 'HEAD', 'OPTIONS')])
        self.check('F: no page errors', not self.errors, self.errors[:5])
        self.check('F: no HTTP >=400 (excluding favicon)', not self.responses, self.responses[:5])

    async def main(self):
        failure = None
        async with async_playwright() as pw:
            browser = await pw.chromium.launch(headless=True, args=['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--use-file-for-fake-audio-capture=' + str(self.wav.resolve()), '--autoplay-policy=no-user-gesture-required'])
            try: await self.run(browser)
            except Exception:
                failure = traceback.format_exc(); print(failure, flush=True)
                for ci, ctx in enumerate(self.contexts):
                    for pi, p in enumerate(ctx.pages):
                        try: await self.screenshot(p, f'failure-{ci}-{pi}')
                        except Exception: pass
            await browser.close()
        res = {'passed': sum(r['pass'] for r in self.rows), 'total': len(self.rows), 'failed': [r for r in self.rows if not r['pass']], 'failure': failure, 'checks': self.rows,
               'requests': self.requests, 'page_errors': self.errors, 'failed_http': self.responses,
               'scope': 'real Chromium UI/IndexedDB/MediaRecorder with synthetic identities, files and devices; real Paraformer only in section H; no physical phone, human speech or cross-device sync claims'}
        (self.out / 'browser-adversarial-result.json').write_text(json.dumps(res, ensure_ascii=False, indent=2))
        print(json.dumps({k: res[k] for k in ('passed', 'total')}, ensure_ascii=False))
        if res['failed'] or failure:
            print('FAILED:', json.dumps(res['failed'], ensure_ascii=False))
            raise SystemExit(1)


asyncio.run(Live(args).main())
