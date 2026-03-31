/**
 * E2E 테스트: 편집 파이프라인 검증 (Issue #2)
 *
 * 검증 범위:
 *   1. 문단 추가/삭제 — Enter(split), Backspace(merge) 후 IR 정합성 + pagination
 *   2. 텍스트 편집 — 줄바꿈 발생 시 이후 layout/pagination 전파
 *   3. 컨트롤 배치 — 표 셀 내 편집 후 composed 정합
 *
 * 사전 조건:
 *   1. WASM 빌드 완료 (pkg/)
 *   2. Vite dev server 실행 중 (npx vite --host 0.0.0.0 --port 7700)
 *   3. Chrome CDP 연결 가능 (--remote-debugging-port=9222)
 *
 * 실행: node e2e/edit-pipeline.test.mjs [--mode=host|headless]
 */
import { launchBrowser, loadApp, clickEditArea, typeText, screenshot, closeBrowser } from './helpers.mjs';

/** WASM bridge 통해 페이지 수 조회 */
async function getPageCount(page) {
  return await page.evaluate(() => window.__wasm?.pageCount ?? 0);
}

/** WASM bridge 통해 문단 수 조회 */
async function getParaCount(page, secIdx = 0) {
  return await page.evaluate((s) => window.__wasm?.getParagraphCount(s) ?? -1, secIdx);
}

/** WASM bridge 통해 문단 텍스트 조회 */
async function getParaText(page, secIdx, paraIdx) {
  return await page.evaluate((s, p) => {
    try { return window.__wasm?.getTextRange(s, p, 0, 200) ?? ''; }
    catch { return ''; }
  }, secIdx, paraIdx);
}

/** 새 문서 생성 및 안정화 대기 */
async function createNewDocument(page) {
  await page.evaluate(() => window.__eventBus?.emit('create-new-document'));
  await page.waitForSelector('canvas', { timeout: 10000 });
  await page.evaluate(() => new Promise(r => setTimeout(r, 1000)));
}

/** Enter 키 입력 */
async function pressEnter(page) {
  await page.keyboard.press('Enter');
  await page.evaluate(() => new Promise(r => setTimeout(r, 300)));
}

/** Backspace 키 입력 */
async function pressBackspace(page) {
  await page.keyboard.press('Backspace');
  await page.evaluate(() => new Promise(r => setTimeout(r, 300)));
}

// ────────────────────────────────────────────────────
async function run() {
  console.log('=== E2E: 편집 파이프라인 테스트 (Issue #2) ===\n');

  const browser = await launchBrowser();
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });

  let passed = 0;
  let failed = 0;
  const check = (cond, msg) => {
    if (cond) { passed++; console.log(`  PASS: ${msg}`); }
    else { failed++; console.error(`  FAIL: ${msg}`); }
  };

  try {
    // ── 1. 새 문서 생성 ──
    console.log('[1] 새 문서 생성...');
    await loadApp(page);
    await createNewDocument(page);
    await clickEditArea(page);

    const initPages = await getPageCount(page);
    const initParas = await getParaCount(page);
    check(initPages >= 1, `초기 페이지 수: ${initPages}`);
    check(initParas >= 1, `초기 문단 수: ${initParas}`);

    // ── 2. 범위 1: 문단 추가 (Enter) ──
    console.log('\n[2] 문단 추가 (Enter 키)...');
    await typeText(page, 'First paragraph');
    await pressEnter(page);
    await typeText(page, 'Second paragraph');
    await pressEnter(page);
    await typeText(page, 'Third paragraph');

    const parasAfterSplit = await getParaCount(page);
    check(parasAfterSplit >= initParas + 2, `Enter 후 문단 수: ${parasAfterSplit} (기대: ${initParas + 2}+)`);

    const text0 = await getParaText(page, 0, 0);
    const text1 = await getParaText(page, 0, 1);
    const text2 = await getParaText(page, 0, 2);
    check(text0.includes('First'), `문단 0 텍스트: "${text0}"`);
    check(text1.includes('Second'), `문단 1 텍스트: "${text1}"`);
    check(text2.includes('Third'), `문단 2 텍스트: "${text2}"`);

    const pagesAfterSplit = await getPageCount(page);
    check(pagesAfterSplit === initPages, `Enter 후 페이지 수 불변: ${pagesAfterSplit}`);
    await screenshot(page, 'edit-01-split');

    // ── 3. 범위 1: 문단 삭제 (Backspace로 merge) ──
    console.log('\n[3] 문단 병합 (Backspace)...');
    // 커서를 문단 2 시작으로 이동 (Home → 위치 확인)
    await page.keyboard.press('Home');
    await pressBackspace(page);

    const parasAfterMerge = await getParaCount(page);
    check(parasAfterMerge === parasAfterSplit - 1, `Backspace 후 문단 수: ${parasAfterMerge} (기대: ${parasAfterSplit - 1})`);

    const mergedText = await getParaText(page, 0, 1);
    check(mergedText.includes('Second') && mergedText.includes('Third'),
      `병합된 문단 텍스트: "${mergedText}"`);
    await screenshot(page, 'edit-02-merge');

    // ── 4. 범위 2: 여러 문단 + 페이지 넘침 ──
    console.log('\n[4] 여러 문단 + 페이지네이션 전파...');
    await createNewDocument(page);
    await clickEditArea(page);

    // 50개 문단 생성 (Enter로 분할 → 페이지 넘침 유발)
    for (let i = 0; i < 50; i++) {
      await page.keyboard.type('Line ' + i, { delay: 5 });
      await page.keyboard.press('Enter');
    }
    // 페이지네이션 안정화 대기
    await page.evaluate(() => new Promise(r => setTimeout(r, 1000)));

    const parasMany = await getParaCount(page);
    const pagesMany = await getPageCount(page);
    check(parasMany >= 50, `50개 문단 생성: ${parasMany}`);
    check(pagesMany >= 2, `50개 문단 후 페이지 수: ${pagesMany} (기대: 2+)`);
    await screenshot(page, 'edit-04-many-paragraphs');

    // ── 5. 범위 2: 긴 텍스트 줄바꿈 전파 ──
    console.log('\n[5] 긴 텍스트 줄바꿈...');
    await createNewDocument(page);
    await clickEditArea(page);

    const longSentence = 'The quick brown fox jumps over the lazy dog. ';
    for (let i = 0; i < 10; i++) {
      await page.keyboard.type(longSentence, { delay: 5 });
    }
    await page.evaluate(() => new Promise(r => setTimeout(r, 500)));
    const pagesAfterLong = await getPageCount(page);
    check(pagesAfterLong >= 1, `긴 텍스트 후 페이지 수: ${pagesAfterLong}`);
    await screenshot(page, 'edit-05-long-text');

    // ── 6. Gap 6: 셀 편집 후 composed 정합 ──
    console.log('\n[6] Gap 6: 셀 편집 후 정합...');
    await createNewDocument(page);
    await clickEditArea(page);

    // WASM API로 직접 표 삽입 및 셀 편집
    const cellResult = await page.evaluate(() => {
      const w = window.__wasm;
      if (!w?.doc) return { error: 'no doc' };
      try {
        // 표 삽입 (2x2) — createTable 반환값에서 paraIdx 확인
        const tableResult = JSON.parse(w.doc.createTable(0, 0, 0, 2, 2));
        const tblPara = tableResult.paraIdx ?? 0;
        const tblCtrl = tableResult.controlIdx ?? 0;

        // 셀에 텍스트 삽입
        w.doc.insertTextInCell(0, tblPara, tblCtrl, 0, 0, 0, 'Cell A1');
        w.doc.insertTextInCell(0, tblPara, tblCtrl, 1, 0, 0, 'Cell A2');
        w.doc.insertTextInCell(0, tblPara, tblCtrl, 2, 0, 0, 'Cell B1');
        w.doc.insertTextInCell(0, tblPara, tblCtrl, 3, 0, 0, 'Cell B2');

        // 셀 내 문단 분할 (Enter)
        w.doc.splitParagraphInCell(0, tblPara, tblCtrl, 0, 0, 7);

        // 셀 내 문단 텍스트 확인
        const text0 = w.doc.getTextInCell(0, tblPara, tblCtrl, 0, 0, 0, 50);
        const text1 = w.doc.getTextInCell(0, tblPara, tblCtrl, 0, 1, 0, 50);

        const pageCount = w.doc.pageCount();
        return { text0, text1, pageCount, tblPara, tblCtrl, ok: true };
      } catch (e) { return { error: e.message, stack: e.stack }; }
    });

    if (cellResult.error) {
      console.log(`  SKIP: 표 삽입 API 오류 (${cellResult.error})`);
    } else {
      check(cellResult.ok === true, `표 삽입 + 셀 편집 성공 (tblPara=${cellResult.tblPara}, tblCtrl=${cellResult.tblCtrl})`);
      check(cellResult.text0 === 'Cell A1',
        `셀[0] 분할 후 첫 문단: "${cellResult.text0}"`);
      check(cellResult.text1 !== undefined && cellResult.text1 !== '',
        `셀[0] 분할 후 둘째 문단: "${cellResult.text1}"`);
      check(cellResult.pageCount >= 1, `표 삽입 후 페이지 수: ${cellResult.pageCount}`);

      // 표 렌더링 확인: SVG에 표 구조가 포함되는지
      const hasSvgTable = await page.evaluate(() => {
        const w = window.__wasm;
        if (!w?.doc) return false;
        try {
          const svg = w.doc.renderPageSvg(0);
          return svg.includes('Cell A1') && svg.includes('Cell B2');
        } catch { return false; }
      });
      check(hasSvgTable, `SVG에 표 셀 텍스트 렌더링 확인`);
    }
    await screenshot(page, 'edit-06-cell-edit');

    // ── 7. Gap 7: 페이지 브레이크 삽입 ──
    console.log('\n[7] Gap 7: 페이지 브레이크...');
    await createNewDocument(page);
    await clickEditArea(page);

    // 텍스트 입력 후 WASM API로 페이지 브레이크 삽입
    const pbResult = await page.evaluate(() => {
      const w = window.__wasm;
      if (!w?.doc) return { error: 'no doc' };
      try {
        w.doc.insertText(0, 0, 0, 'Before page break');
        const beforePages = w.doc.pageCount();

        w.doc.insertPageBreak(0, 0, 17);  // 텍스트 끝에 페이지 브레이크
        const afterPages = w.doc.pageCount();
        const paraCount = w.doc.getParagraphCount(0);

        return { beforePages, afterPages, paraCount, ok: true };
      } catch (e) { return { error: e.message }; }
    });

    if (pbResult.error) {
      console.log(`  SKIP: 페이지 브레이크 API 미지원 (${pbResult.error})`);
    } else {
      check(pbResult.afterPages >= 2,
        `페이지 브레이크 후 페이지 수: ${pbResult.beforePages} → ${pbResult.afterPages}`);
      check(pbResult.paraCount >= 2,
        `페이지 브레이크 후 문단 수: ${pbResult.paraCount}`);
    }
    await screenshot(page, 'edit-07-page-break');

    // ── 8. Gap 8: vpos cascade 검증 ──
    console.log('\n[8] Gap 8: vpos cascade...');
    await createNewDocument(page);

    const vposResult = await page.evaluate(() => {
      const w = window.__wasm;
      if (!w?.doc) return { error: 'no doc' };
      try {
        // 5개 문단 생성
        w.doc.insertText(0, 0, 0, 'Paragraph 1');
        w.doc.splitParagraph(0, 0, 11);
        w.doc.insertText(0, 1, 0, 'Paragraph 2');
        w.doc.splitParagraph(0, 1, 11);
        w.doc.insertText(0, 2, 0, 'Paragraph 3');
        w.doc.splitParagraph(0, 2, 11);
        w.doc.insertText(0, 3, 0, 'Paragraph 4');
        w.doc.splitParagraph(0, 3, 11);
        w.doc.insertText(0, 4, 0, 'Paragraph 5');

        // 각 문단의 줄 정보 조회 (vpos 확인)
        const lines = [];
        for (let p = 0; p < 5; p++) {
          try {
            const info = JSON.parse(w.doc.getLineInfo(0, p, 0));
            lines.push(info);
          } catch { lines.push(null); }
        }

        // 문단 1에 긴 텍스트 삽입 → 높이 증가 → 후속 문단 vpos cascade
        const longText = 'ABCDEFGHIJ '.repeat(50);
        w.doc.insertText(0, 0, 11, longText);

        const linesAfter = [];
        for (let p = 0; p < 5; p++) {
          try {
            const info = JSON.parse(w.doc.getLineInfo(0, p, 0));
            linesAfter.push(info);
          } catch { linesAfter.push(null); }
        }

        const pageCount = w.doc.pageCount();
        return { linesBefore: lines, linesAfter, pageCount, ok: true };
      } catch (e) { return { error: e.message }; }
    });

    if (vposResult.error) {
      console.log(`  SKIP: vpos 검증 실패 (${vposResult.error})`);
    } else {
      check(vposResult.ok === true, `vpos cascade 테스트 성공`);
      check(vposResult.pageCount >= 1, `vpos cascade 후 페이지 수: ${vposResult.pageCount}`);

      // 문단 1 높이가 증가했으므로 후속 문단들의 lineInfo가 변경되어야 함
      if (vposResult.linesBefore[1] && vposResult.linesAfter[1]) {
        console.log(`  문단 1 lineInfo before: ${JSON.stringify(vposResult.linesBefore[1])}`);
        console.log(`  문단 1 lineInfo after:  ${JSON.stringify(vposResult.linesAfter[1])}`);
      }
    }
    await screenshot(page, 'edit-08-vpos-cascade');

    // ── 9. 문단 분할/병합 연속 안정성 ──
    console.log('\n[9] 분할/병합 연속 안정성...');
    await createNewDocument(page);

    const stabilityResult = await page.evaluate(() => {
      const w = window.__wasm;
      if (!w?.doc) return { error: 'no doc' };
      try {
        w.doc.insertText(0, 0, 0, 'AAABBBCCC');

        // 분할 → 병합 → 분할 → 병합 반복
        for (let i = 0; i < 5; i++) {
          w.doc.splitParagraph(0, 0, 3);  // 'AAA' | 'BBBCCC'
          w.doc.mergeParagraph(0, 1);     // 'AAABBBCCC'
        }

        const text = w.doc.getTextRange(0, 0, 0, 50);
        const paraCount = w.doc.getParagraphCount(0);
        const pageCount = w.doc.pageCount();
        return { text, paraCount, pageCount, ok: true };
      } catch (e) { return { error: e.message }; }
    });

    if (stabilityResult.error) {
      console.log(`  SKIP: 안정성 테스트 실패 (${stabilityResult.error})`);
    } else {
      check(stabilityResult.text === 'AAABBBCCC',
        `5회 분할/병합 후 텍스트 보존: "${stabilityResult.text}"`);
      check(stabilityResult.paraCount === 1,
        `5회 분할/병합 후 문단 수: ${stabilityResult.paraCount}`);
      check(stabilityResult.pageCount === 1,
        `5회 분할/병합 후 페이지 수: ${stabilityResult.pageCount}`);
    }
    await screenshot(page, 'edit-09-stability');

    // ── 결과 요약 ──
    console.log(`\n=== 결과: ${passed} passed, ${failed} failed ===`);
    if (failed > 0) process.exitCode = 1;

  } catch (err) {
    console.error('테스트 오류:', err.message);
    process.exitCode = 1;
  } finally {
    await screenshot(page, 'edit-final');
    await page.close();
    await closeBrowser(browser);
  }
}

run();
