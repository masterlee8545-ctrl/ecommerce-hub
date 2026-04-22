/**
 * DB 스키마 진입점 (Re-export Hub)
 *
 * 모든 표(테이블) 정의를 여기서 한 번에 export.
 * Drizzle Kit이 이 파일을 보고 마이그레이션을 생성한다 (drizzle.config.ts schema 옵션).
 *
 * 출처: docs/DATA_MODEL.md §1 (총 21개 테이블)
 *
 * 그룹:
 * - A: 코어 (3개)         — companies, users, user_companies
 * - B: 파이프라인 (8개)    — products, product_state_history, keywords,
 *                           coupang_review_snapshots, suppliers, quotes,
 *                           purchase_orders, listings
 * - C: 마케팅 (6개)        — ad_campaigns, ad_groups, ad_keywords, ad_metrics,
 *                           seo_targets, keyword_rankings
 * - D: 운영 (4개)          — tasks, task_history, tariff_presets, notifications
 *
 * 임포트 순서 주의:
 * 다른 표를 references()로 가리키는 표는 그 다음에 와야 한다.
 * 예) products → suppliers, keywords; quotes → products, suppliers
 */

// ───────────────────────────────────────────────────────────
// 그룹 A — 코어 (3)
// ───────────────────────────────────────────────────────────
export * from './companies';
export * from './users';
export * from './user-companies';

// ───────────────────────────────────────────────────────────
// 그룹 B — 파이프라인 (8)
// ───────────────────────────────────────────────────────────
// 의존성 없는 것 먼저
export * from './suppliers';
export * from './keywords';
export * from './coupang-review-snapshots';
export * from './research-review-analyses';
// products는 suppliers, keywords를 참조
export * from './products';
// 나머지는 products를 참조
export * from './product-state-history';
export * from './product-plans'; //      Step 4 — 상세페이지 기획서
export * from './marketing-activities'; // Step 7 — 마케팅 작업 트래킹
export * from './scrape-jobs'; //         배치 분석 — Vercel+Supabase+로컬워커 큐
export * from './quotes';
export * from './purchase-orders';
export * from './listings';

// ───────────────────────────────────────────────────────────
// 그룹 C — 마케팅 (6)
// ───────────────────────────────────────────────────────────
// 광고 트리: campaigns → groups → keywords → metrics
export * from './ad-campaigns';
export * from './ad-groups';
export * from './ad-keywords';
export * from './ad-metrics';
// SEO 추적: seo_targets → keyword_rankings
export * from './seo-targets';
export * from './keyword-rankings';

// ───────────────────────────────────────────────────────────
// 그룹 D — 운영 (5)
// ───────────────────────────────────────────────────────────
// tasks를 task_history와 notifications가 참조
export * from './tasks';
export * from './task-history';
export * from './tariff-presets';
export * from './notifications';
export * from './mcp-tokens'; // Phase B — Claude.ai MCP 인증
