/**
 * 계약 검증 · 셀렉터 역추출 · 표 추출 테스트.
 *
 * 브라우저 없이 돈다 — 그게 파싱을 Node 로 옮긴 이유다.
 * 픽스처는 셀록홈즈 표 구조를 최소한으로 흉내 낸 것이고, 실제 계정 정보는 없다.
 */
import { describe, expect, it } from 'vitest';

import {
  checkCssContract,
  discoverCandidates,
  extractRows,
  indexOfFirstMatch,
  isStableToken,
  literalFromRegex,
} from './dom';

/** 정상 표: 행 3개, 각 행에 상품명·가격·리뷰·링크. */
function healthyTable(): string {
  const rows = [1, 2, 3]
    .map(
      (rank) => `
      <ul class="td" data-rank="${rank}" data-coupangid="c${rank}" data-itemid="i${rank}">
        <li class="name">
          <div class="prd-img"><img src="https://img.example.com/${rank}.jpg" alt=""></div>
          <div class="goods-name"><a href="https://www.coupang.com/vp/products/${rank}">상품 ${rank}</a></div>
        </li>
        <li class="price">12,${rank}00원</li>
        <li class="review"><span class="num">${rank * 10}</span></li>
        ${rank === 1 ? '<li class="del rocket">로켓배송</li>' : ''}
      </ul>`,
    )
    .join('');
  return `<html><body><div class="list">${rows}</div>
    <button class="search-icon">검색</button>
    <button>선택</button>
    <button>취소</button>
    <ul class="dropdown"><li>1 페이지 상품분석</li><li>2 페이지 상품분석</li></ul>
  </body></html>`;
}

/** 클래스명이 배포마다 바뀌는 난수로 교체된 표. `data-rank` 만 그대로. */
function hashedTable(): string {
  const rows = [1, 2, 3]
    .map(
      (rank) => `
      <ul class="sc-bdVaJa xKlMnO" data-rank="${rank}">
        <li class="jsx-92831 aBcDeF"><a href="https://www.coupang.com/vp/products/${rank}">상품 ${rank}</a></li>
      </ul>`,
    )
    .join('');
  return `<html><body>${rows}</body></html>`;
}

describe('checkCssContract', () => {
  it('계약을 만족하면 매칭 수와 함께 통과한다', () => {
    const result = checkCssContract(healthyTable(), 'ul.td[data-rank]', {
      minMatches: 3,
      attr: 'data-rank',
      mustMatch: '^\\d+$',
    });
    expect(result.ok).toBe(true);
    expect(result.matches).toBe(3);
  });

  it('개수가 모자라면 실패 사유에 몇 건인지 남긴다', () => {
    const result = checkCssContract(healthyTable(), 'ul.td[data-rank]', { minMatches: 10 });
    expect(result.ok).toBe(false);
    expect(result.matches).toBe(3);
    expect(result.reason).toContain('3건');
  });

  it('셀렉터가 아무것도 못 잡으면 0건으로 실패한다 — 예외를 던지지 않는다', () => {
    const result = checkCssContract(healthyTable(), 'ul.gone[data-rank]', { minMatches: 1 });
    expect(result.ok).toBe(false);
    expect(result.matches).toBe(0);
  });

  it('attr 이 지정되면 그 속성이 없는 노드는 계약을 만족하지 않는다', () => {
    // li.price 에는 href 가 없다 → 3건 잡히지만 전부 탈락
    const result = checkCssContract(healthyTable(), 'li.price', {
      minMatches: 1,
      attr: 'href',
    });
    expect(result.ok).toBe(false);
    expect(result.matches).toBe(0);
  });

  it('mustMatch 는 속성값에 걸린다', () => {
    const ok = checkCssContract(healthyTable(), 'li.name .goods-name a', {
      minMatches: 3,
      attr: 'href',
      mustMatch: 'coupang\\.com',
    });
    expect(ok.ok).toBe(true);

    const bad = checkCssContract(healthyTable(), 'li.name .goods-name a', {
      minMatches: 1,
      attr: 'href',
      mustMatch: 'naver\\.com',
    });
    expect(bad.ok).toBe(false);
  });

  it('attr 이 없으면 mustMatch 는 노드 텍스트에 걸린다', () => {
    const result = checkCssContract(healthyTable(), 'button', {
      minMatches: 1,
      mustMatch: '^선택$',
    });
    expect(result.ok).toBe(true);
    expect(result.matches).toBe(1); // '검색' 과 '취소' 는 탈락
  });

  it('rootSelector 로 범위를 좁히면 그 컨테이너 자손만 센다', () => {
    const scoped = checkCssContract(
      healthyTable(),
      'li.price',
      { minMatches: 1 },
      'ul.td[data-rank="2"]',
    );
    expect(scoped.ok).toBe(true);
    expect(scoped.matches).toBe(1);
  });

  it('범위 셀렉터가 아무것도 못 잡으면 그 사실을 사유로 알려 준다', () => {
    const result = checkCssContract(healthyTable(), 'li.price', { minMatches: 1 }, 'ul.gone');
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('범위 셀렉터');
  });

  it('계약의 정규식이 잘못되면 검사기가 터지지 않고 사유를 돌려준다', () => {
    const result = checkCssContract(healthyTable(), 'button', { mustMatch: '([' });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('정규식');
  });

  it('HTML 이 비면 통과시키지 않는다', () => {
    expect(checkCssContract('', 'ul', { minMatches: 1 }).ok).toBe(false);
  });

  it('script/style 안의 문자열은 텍스트로 세지 않는다', () => {
    // 회귀 방지: cheerio 의 .text() 는 <script> 소스까지 문자열로 준다.
    // 그대로 두면 "본문에 '익스텐션 설치' 가 있는가" 같은 계약이, 번들 코드에
    // 우연히 그 말이 들어 있다는 이유만으로 참이 되어 정상 화면을 실패로 만든다.
    const html = `<html><body>
      <script>var msg = "익스텐션 설치가 필요합니다";</script>
      <style>.x::after { content: "익스텐션 설치"; }</style>
      <div>정상 화면입니다</div>
    </body></html>`;
    expect(
      checkCssContract(html, 'body', { minMatches: 1, mustMatch: '익스텐션 설치' }).ok,
    ).toBe(false);

    // 실제로 화면에 보이는 안내는 잡아야 한다
    const withNotice = '<html><body><div>익스텐션 설치가 필요합니다</div></body></html>';
    expect(
      checkCssContract(withNotice, 'body', { minMatches: 1, mustMatch: '익스텐션 설치' }).ok,
    ).toBe(true);
  });

  it('범위 셀렉터가 겹쳐도 같은 노드를 두 번 세지 않는다', () => {
    // 중첩된 컨테이너에서 자손을 이중 계수하면 매칭 수가 부풀어 계약이 거짓 통과한다.
    const html = `<html><body>
      <div class="outer box"><div class="inner box"><span class="v">1</span></div></div>
    </body></html>`;
    const result = checkCssContract(html, 'span.v', { minMatches: 1 }, 'div.box');
    expect(result.matches).toBe(1);
  });
});

describe('isStableToken', () => {
  it('사람이 지은 이름은 안정 토큰으로 본다', () => {
    expect(isStableToken('goods-name')).toBe(true);
    expect(isStableToken('search_input')).toBe(true);
    expect(isStableToken('MuiButtonBase')).toBe(true);
  });

  it('CSS-in-JS 접두사와 난수 조각은 버린다', () => {
    expect(isStableToken('sc-bdVaJa')).toBe(false);
    expect(isStableToken('css-1a2b3c')).toBe(false);
    expect(isStableToken('jsx-92831')).toBe(false);
    expect(isStableToken('aBcDeF')).toBe(false);
  });

  it('너무 짧은 토큰은 판단 근거가 없으므로 쓰지 않는다', () => {
    expect(isStableToken('ab')).toBe(false);
  });
});

describe('literalFromRegex', () => {
  it('이스케이프된 점은 리터럴 점으로 되돌린다', () => {
    expect(literalFromRegex('coupang\\.com')).toBe('coupang.com');
  });

  it('후보가 여럿이면 가장 긴 것을 고른다', () => {
    expect(literalFromRegex('cafe\\.naver\\.com|/r/')).toBe('cafe.naver.com');
  });

  it('짧은 조각뿐이면 쓸 리터럴이 없다고 본다', () => {
    expect(literalFromRegex('^\\d+$')).toBeNull();
  });
});

describe('discoverCandidates', () => {
  it('클래스가 난수로 바뀌어도 속성 계약으로 행을 다시 찾아낸다', () => {
    const html = hashedTable();
    const spec = { minMatches: 3, attr: 'data-rank', mustMatch: '^\\d+$' };

    // 원래 셀렉터는 이미 깨졌다
    expect(checkCssContract(html, 'ul.td[data-rank]', spec).ok).toBe(false);

    const candidates = discoverCandidates(html, spec);
    expect(candidates.length).toBeGreaterThan(0);

    // 내놓은 후보는 전부 계약을 통과해야 한다
    for (const candidate of candidates) {
      expect(checkCssContract(html, candidate, spec).ok).toBe(true);
    }
  });

  it('난수 클래스를 후보 셀렉터에 쓰지 않는다', () => {
    const candidates = discoverCandidates(hashedTable(), {
      minMatches: 3,
      attr: 'data-rank',
      mustMatch: '^\\d+$',
    });
    for (const candidate of candidates) {
      expect(candidate).not.toContain('sc-bdVaJa');
      expect(candidate).not.toContain('xKlMnO');
      expect(candidate).not.toContain('jsx-');
    }
  });

  it('정답 노드에 data-testid 가 있으면 그걸 후보로 쓴다', () => {
    // 시맨틱 속성은 **정답 노드 자신**에서만 본다 (부모의 속성은 보지 않는다).
    // 클래스는 전부 난수라 쓸 수 없고, data-testid 만 살아남는 상황.
    const html = `<html><body>
      <div class="css-9f8a7b"><a data-testid="row-link" class="css-11" href="https://www.coupang.com/vp/products/1">A</a></div>
      <div class="css-1c2d3e"><a data-testid="row-link" class="css-22" href="https://www.coupang.com/vp/products/2">B</a></div>
      <div class="css-4f5g6h"><a data-testid="row-link" class="css-33" href="https://www.coupang.com/vp/products/3">C</a></div>
    </body></html>`;
    const candidates = discoverCandidates(html, {
      minMatches: 3,
      attr: 'href',
      mustMatch: 'coupang\\.com',
    });
    expect(candidates.some((c) => c.includes('data-testid="row-link"'))).toBe(true);
  });

  it('제약이 하나도 없는 계약이면 정답을 특정할 수 없어 빈 배열을 돌려준다', () => {
    expect(discoverCandidates(healthyTable(), { minMatches: 3 })).toEqual([]);
  });

  it('정답이 최소 개수에 못 미치면 후보를 만들지 않는다', () => {
    const spec = { minMatches: 99, attr: 'data-rank', mustMatch: '^\\d+$' };
    expect(discoverCandidates(hashedTable(), spec)).toEqual([]);
  });

  it('범위를 좁히면 그 안에서만 후보를 찾는다', () => {
    const html = healthyTable();
    const candidates = discoverCandidates(
      html,
      { minMatches: 3, attr: 'href', mustMatch: 'coupang\\.com' },
      { rootSelector: 'div.list' },
    );
    expect(candidates.length).toBeGreaterThan(0);
    for (const candidate of candidates) {
      expect(checkCssContract(html, candidate, {
        minMatches: 3,
        attr: 'href',
        mustMatch: 'coupang\\.com',
      }, 'div.list').ok).toBe(true);
    }
  });
});

describe('extractRows', () => {
  const plan = {
    rowSelector: 'ul.td[data-rank]',
    rowAttrs: ['data-rank', 'data-coupangid', 'data-itemid', 'data-missing'],
    fields: [
      { key: 'name', selectors: ['li.name .goods-name', 'li.name'], attr: null },
      { key: 'price', selectors: ['li.price'], attr: null },
      { key: 'review', selectors: ['li.review .num'], attr: null },
      { key: 'link', selectors: ['li.name .goods-name a'], attr: 'href' },
      { key: 'image', selectors: ['li.name .prd-img img'], attr: 'src' },
      { key: 'gone', selectors: ['li.does-not-exist'], attr: null },
      { key: 'viaFallback', selectors: ['li.does-not-exist', 'li.price'], attr: null },
    ],
    flags: [{ key: 'rocket', selectors: ['li.del.rocket'] }],
  };

  it('행마다 속성·값·플래그를 뽑는다', () => {
    const rows = extractRows(healthyTable(), plan);
    expect(rows).toHaveLength(3);

    const first = rows[0];
    expect(first?.attrs['data-rank']).toBe('1');
    expect(first?.attrs['data-coupangid']).toBe('c1');
    expect(first?.fields['name']).toBe('상품 1');
    expect(first?.fields['price']).toBe('12,100원');
    expect(first?.fields['review']).toBe('10');
    expect(first?.fields['link']).toBe('https://www.coupang.com/vp/products/1');
    expect(first?.fields['image']).toBe('https://img.example.com/1.jpg');
    expect(first?.flags['rocket']).toBe(true);
  });

  it('없는 값은 빈 문자열이 아니라 null 이다', () => {
    const rows = extractRows(healthyTable(), plan);
    expect(rows[0]?.fields['gone']).toBeNull();
    expect(rows[0]?.attrs['data-missing']).toBeNull();
  });

  it('앞 셀렉터가 비면 다음 셀렉터로 넘어간다', () => {
    const rows = extractRows(healthyTable(), plan);
    expect(rows[0]?.fields['viaFallback']).toBe('12,100원');
  });

  it('플래그가 없는 행은 false 다', () => {
    const rows = extractRows(healthyTable(), plan);
    expect(rows[1]?.flags['rocket']).toBe(false);
  });

  it('행 셀렉터가 안 맞으면 빈 배열이다 — 이 사실은 계약 검증이 따로 잡는다', () => {
    expect(extractRows(healthyTable(), { ...plan, rowSelector: 'ul.gone' })).toEqual([]);
  });
});

describe('indexOfFirstMatch', () => {
  it('텍스트 계약을 만족하는 첫 요소의 순번을 알려 준다', () => {
    // 문서의 button 순서: 검색(0), 선택(1), 취소(2)
    expect(indexOfFirstMatch(healthyTable(), 'button', { mustMatch: '^선택$' })).toBe(1);
  });

  it('드롭다운 항목도 정확히 하나만 고른다', () => {
    expect(
      indexOfFirstMatch(healthyTable(), 'li', { mustMatch: '^1 페이지 상품분석$' }),
    ).toBeGreaterThanOrEqual(0);
  });

  it('만족하는 요소가 없으면 -1', () => {
    expect(indexOfFirstMatch(healthyTable(), 'button', { mustMatch: '^없는버튼$' })).toBe(-1);
  });
});
