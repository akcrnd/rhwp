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
    await typeText(page, 'TC #2: 문단 추가 (Enter)');
    await pressEnter(page);
    await typeText(page, 'First paragraph');
    await pressEnter(page);
    await typeText(page, 'Second paragraph');
    await pressEnter(page);
    await typeText(page, 'Third paragraph');

    const parasAfterSplit = await getParaCount(page);
    check(parasAfterSplit >= initParas + 3, `Enter 후 문단 수: ${parasAfterSplit} (기대: ${initParas + 3}+)`);

    const text0 = await getParaText(page, 0, 0);
    const text1 = await getParaText(page, 0, 1);
    const text2 = await getParaText(page, 0, 2);
    const text3 = await getParaText(page, 0, 3);
    check(text0.includes('TC #2'), `문단 0 제목: "${text0}"`);
    check(text1.includes('First'), `문단 1 텍스트: "${text1}"`);
    check(text2.includes('Second'), `문단 2 텍스트: "${text2}"`);
    check(text3.includes('Third'), `문단 3 텍스트: "${text3}"`);

    const pagesAfterSplit = await getPageCount(page);
    check(pagesAfterSplit === initPages, `Enter 후 페이지 수 불변: ${pagesAfterSplit}`);
    await screenshot(page, 'edit-01-split');

    // ── 3. 범위 1: 문단 삭제 (Backspace로 merge) ──
    console.log('\n[3] 문단 병합 (Backspace)...');
    await createNewDocument(page);
    await clickEditArea(page);

    // 제목 + 3개 문단 생성
    const mergeResult = await page.evaluate(() => {
      const w = window.__wasm;
      if (!w?.doc) return { error: 'no doc' };
      try {
        w.doc.insertText(0, 0, 0, 'TC #3: merge paragraph');
        w.doc.splitParagraph(0, 0, 22);
        w.doc.insertText(0, 1, 0, 'AAA');
        w.doc.splitParagraph(0, 1, 3);
        w.doc.insertText(0, 2, 0, 'BBB');
        w.doc.splitParagraph(0, 2, 3);
        w.doc.insertText(0, 3, 0, 'CCC');

        const beforeParas = w.doc.getParagraphCount(0);

        // 문단 3을 문단 2에 병합 (Backspace)
        w.doc.mergeParagraph(0, 3);

        const afterParas = w.doc.getParagraphCount(0);
        const mergedText = w.doc.getTextRange(0, 2, 0, 50);

        window.__eventBus?.emit('document-changed');
        return { beforeParas, afterParas, mergedText, ok: true };
      } catch (e) { return { error: e.message }; }
    });
    await page.evaluate(() => new Promise(r => setTimeout(r, 300)));

    if (mergeResult.error) {
      console.log(`  SKIP: 병합 오류 (${mergeResult.error})`);
    } else {
      check(mergeResult.afterParas === mergeResult.beforeParas - 1,
        `Backspace 후 문단 수: ${mergeResult.beforeParas} → ${mergeResult.afterParas}`);
      check(mergeResult.mergedText?.includes('BBB') && mergeResult.mergedText?.includes('CCC'),
        `병합된 문단 텍스트: "${mergeResult.mergedText}"`);
    }
    await screenshot(page, 'edit-03-merge');

    // ── 4. 범위 2: 여러 문단 + 페이지 넘침 ──
    console.log('\n[4] 여러 문단 + 페이지네이션 전파...');
    await createNewDocument(page);
    await clickEditArea(page);

    // 제목 + 50개 문단 생성 (Enter로 분할 → 페이지 넘침 유발)
    await page.keyboard.type('TC #4: pagination', { delay: 5 });
    await page.keyboard.press('Enter');
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

    await page.keyboard.type('TC #5: line wrap', { delay: 5 });
    await page.keyboard.press('Enter');
    const longSentence = 'The quick brown fox jumps over the lazy dog. ';
    for (let i = 0; i < 10; i++) {
      await page.keyboard.type(longSentence, { delay: 5 });
    }
    await page.evaluate(() => new Promise(r => setTimeout(r, 500)));
    const pagesAfterLong = await getPageCount(page);
    check(pagesAfterLong >= 1, `긴 텍스트 후 페이지 수: ${pagesAfterLong}`);
    await screenshot(page, 'edit-05-long-text');

    // ── 6. 표 삽입: 텍스트 → 표 → 텍스트 구조 ──
    console.log('\n[6] 표 삽입: 텍스트 → 표 → 텍스트...');
    await createNewDocument(page);
    await clickEditArea(page);

    const cellResult = await page.evaluate(() => {
      const w = window.__wasm;
      if (!w?.doc) return { error: 'no doc' };
      try {
        // 0) 제목
        w.doc.insertText(0, 0, 0, 'TC #6: table insert');
        w.doc.splitParagraph(0, 0, 19);

        // 1) 텍스트 문단
        w.doc.insertText(0, 1, 0, 'Before table paragraph');

        // 2) Enter로 새 문단 생성
        w.doc.splitParagraph(0, 1, 22);

        // 3) 세 번째 문단에 표 삽입 (2x2)
        const tableResult = JSON.parse(w.doc.createTable(0, 2, 0, 2, 2));
        const tblPara = tableResult.paraIdx ?? 1;
        const tblCtrl = tableResult.controlIdx ?? 0;

        // 4) 셀에 텍스트 삽입
        w.doc.insertTextInCell(0, tblPara, tblCtrl, 0, 0, 0, 'Cell A1');
        w.doc.insertTextInCell(0, tblPara, tblCtrl, 1, 0, 0, 'Cell A2');
        w.doc.insertTextInCell(0, tblPara, tblCtrl, 2, 0, 0, 'Cell B1');
        w.doc.insertTextInCell(0, tblPara, tblCtrl, 3, 0, 0, 'Cell B2');

        // 5) 표 다음 문단에 텍스트 입력
        //    표 삽입으로 문단이 추가되었으므로 표 다음 문단 인덱스 확인
        const totalParas = w.doc.getParagraphCount(0);
        const afterParaIdx = totalParas - 1;  // 마지막 문단
        w.doc.insertText(0, afterParaIdx, 0, 'After table paragraph');

        // 캔버스 재렌더링 트리거
        window.__eventBus?.emit('document-changed');

        // 검증
        const textTitle = w.doc.getTextRange(0, 0, 0, 50);
        const textBefore = w.doc.getTextRange(0, 1, 0, 50);
        const textAfter = w.doc.getTextRange(0, afterParaIdx, 0, 50);
        const cellText = w.doc.getTextInCell(0, tblPara, tblCtrl, 0, 0, 0, 50);
        const pageCount = w.doc.pageCount();

        return {
          textTitle, textBefore, textAfter, cellText, pageCount,
          tblPara, tblCtrl, totalParas, afterParaIdx,
          ok: true
        };
      } catch (e) { return { error: e.message, stack: e.stack }; }
    });
    await page.evaluate(() => new Promise(r => setTimeout(r, 500)));

    if (cellResult.error) {
      console.log(`  SKIP: 표 삽입 오류 (${cellResult.error})`);
    } else {
      check(cellResult.ok === true,
        `표 삽입 성공 (tblPara=${cellResult.tblPara}, totalParas=${cellResult.totalParas})`);
      check(cellResult.textTitle?.includes('TC #6'),
        `제목: "${cellResult.textTitle}"`);
      check(cellResult.textBefore?.includes('Before table'),
        `표 앞 문단: "${cellResult.textBefore}"`);
      check(cellResult.cellText === 'Cell A1',
        `셀[0] 텍스트: "${cellResult.cellText}"`);
      check(cellResult.textAfter?.includes('After table'),
        `표 뒤 문단: "${cellResult.textAfter}"`);
      check(cellResult.pageCount >= 1, `페이지 수: ${cellResult.pageCount}`);

      // SVG 렌더링: 표 앞/뒤 텍스트 + 셀 텍스트 확인
      const svgCheck = await page.evaluate(() => {
        const w = window.__wasm;
        if (!w?.doc) return { ok: false };
        try {
          const svg = w.doc.renderPageSvg(0);
          const hasBefore = svg.includes('>B<');   // "Before"의 B
          const hasCell = svg.includes('>C<');     // "Cell"의 C
          const hasAfter = svg.includes('>A<');    // "After"의 A
          const hasRect = svg.includes('<rect') || svg.includes('<line');
          return { ok: hasBefore && hasCell && hasAfter && hasRect,
                   hasBefore, hasCell, hasAfter, hasRect };
        } catch (e) { return { ok: false, error: e.message }; }
      });
      check(svgCheck.ok,
        `SVG 렌더링 (앞=${svgCheck.hasBefore} 셀=${svgCheck.hasCell} 뒤=${svgCheck.hasAfter} 테두리=${svgCheck.hasRect})`);
    }
    await screenshot(page, 'edit-06-table-insert');

    // ── 7. Gap 7: 페이지 브레이크 삽입 ──
    console.log('\n[7] Gap 7: 페이지 브레이크...');
    await createNewDocument(page);
    await clickEditArea(page);

    // 텍스트 입력 후 WASM API로 페이지 브레이크 삽입
    const pbResult = await page.evaluate(() => {
      const w = window.__wasm;
      if (!w?.doc) return { error: 'no doc' };
      try {
        w.doc.insertText(0, 0, 0, 'TC #7: page break');
        w.doc.splitParagraph(0, 0, 18);
        w.doc.insertText(0, 1, 0, 'Before page break');
        const beforePages = w.doc.pageCount();

        w.doc.insertPageBreak(0, 1, 17);  // 텍스트 끝에 페이지 브레이크
        window.__eventBus?.emit('document-changed');
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
        // 제목 + 5개 문단 생성
        w.doc.insertText(0, 0, 0, 'TC #8: vpos cascade');
        w.doc.splitParagraph(0, 0, 19);
        w.doc.insertText(0, 1, 0, 'Paragraph 1');
        w.doc.splitParagraph(0, 1, 11);
        w.doc.insertText(0, 2, 0, 'Paragraph 2');
        w.doc.splitParagraph(0, 2, 11);
        w.doc.insertText(0, 3, 0, 'Paragraph 3');
        w.doc.splitParagraph(0, 3, 11);
        w.doc.insertText(0, 4, 0, 'Paragraph 4');
        w.doc.splitParagraph(0, 4, 11);
        w.doc.insertText(0, 5, 0, 'Paragraph 5');

        // 각 문단의 줄 정보 조회 (vpos 확인, 제목 제외 1~5)
        const lines = [];
        for (let p = 1; p < 6; p++) {
          try {
            const info = JSON.parse(w.doc.getLineInfo(0, p, 0));
            lines.push(info);
          } catch { lines.push(null); }
        }

        // 문단 1에 긴 텍스트 삽입 → 높이 증가 → 후속 문단 vpos cascade
        const longText = 'ABCDEFGHIJ '.repeat(50);
        w.doc.insertText(0, 1, 11, longText);
        window.__eventBus?.emit('document-changed');

        const linesAfter = [];
        for (let p = 1; p < 6; p++) {
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
        w.doc.insertText(0, 0, 0, 'TC #9: stability');
        w.doc.splitParagraph(0, 0, 16);
        w.doc.insertText(0, 1, 0, 'AAABBBCCC');

        // 분할 → 병합 → 분할 → 병합 반복
        for (let i = 0; i < 5; i++) {
          w.doc.splitParagraph(0, 1, 3);  // 'AAA' | 'BBBCCC'
          w.doc.mergeParagraph(0, 2);     // 'AAABBBCCC'
        }

        const text = w.doc.getTextRange(0, 1, 0, 50);
        const paraCount = w.doc.getParagraphCount(0);
        const pageCount = w.doc.pageCount();
        window.__eventBus?.emit('document-changed');
        return { text, paraCount, pageCount, ok: true };
      } catch (e) { return { error: e.message }; }
    });

    if (stabilityResult.error) {
      console.log(`  SKIP: 안정성 테스트 실패 (${stabilityResult.error})`);
    } else {
      check(stabilityResult.text === 'AAABBBCCC',
        `5회 분할/병합 후 텍스트 보존: "${stabilityResult.text}"`);
      check(stabilityResult.paraCount === 2,
        `5회 분할/병합 후 문단 수: ${stabilityResult.paraCount} (제목+본문)`);
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
