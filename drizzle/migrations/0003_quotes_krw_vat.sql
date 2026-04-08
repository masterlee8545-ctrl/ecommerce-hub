-- ============================================================
-- 0003_quotes_krw_vat.sql — F-1b: quotes 표 KRW/VAT 확장
-- ============================================================
-- 출처: src/db/schema/quotes.ts (F 단계 — 국내 수입 대행업체 거래 구조 반영)
-- 헌법: CLAUDE.md §1 P-3 (estimated 마킹), §1 P-4 (멀티테넌트),
--       §1 P-6 (마이그레이션 불변성 — 한 번 적용된 파일은 수정 금지)
--
-- 배경:
-- 사장님은 국내 수입 대행업체와 거래하므로:
--   - 단가가 처음부터 원화(KRW)로 제시됨 (위안 환율/관세 계산 불필요)
--   - VAT는 보통 단가에 별도 표시 (공급단가 + VAT 10%)
--   - 한 파일(엑셀)에 여러 상품 견적이 들어올 수 있음 → 출처 추적 필요
--
-- 변경 내용:
--   1. unit_price_krw (원화 단가) 컬럼 추가
--   2. vat_rate (부가세율) + vat_included (포함 여부) 추가
--   3. payment_terms (결제조건) 추가
--   4. source_file_name + source_row (벌크 임포트 추적) 추가
--
-- 적용 방법:
--   psql $DATABASE_URL -f drizzle/migrations/0003_quotes_krw_vat.sql
--   또는: drizzle-kit migrate (0002 다음 순서로 자동 적용)
--
-- 변경 금지: 이 파일은 한 번 적용되면 절대 수정 금지 (P-6).
-- 정책 변경이 필요하면 새 마이그레이션 파일(0004_*) 생성.
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. 컬럼 추가 (기존 데이터 호환 — 모두 NULLABLE 또는 DEFAULT)
-- ────────────────────────────────────────────────────────────

ALTER TABLE quotes
  ADD COLUMN IF NOT EXISTS unit_price_krw numeric(12, 2);

ALTER TABLE quotes
  ADD COLUMN IF NOT EXISTS vat_rate numeric(5, 4) DEFAULT 0.1000;

ALTER TABLE quotes
  ADD COLUMN IF NOT EXISTS vat_included boolean NOT NULL DEFAULT false;

ALTER TABLE quotes
  ADD COLUMN IF NOT EXISTS payment_terms text;

ALTER TABLE quotes
  ADD COLUMN IF NOT EXISTS source_file_name text;

ALTER TABLE quotes
  ADD COLUMN IF NOT EXISTS source_row integer;

-- ────────────────────────────────────────────────────────────
-- 2. 무결성 체크 (P-3 간접 강제)
-- ────────────────────────────────────────────────────────────
-- 단가는 음수일 수 없다.
ALTER TABLE quotes
  ADD CONSTRAINT quotes_unit_price_krw_nonneg
  CHECK (unit_price_krw IS NULL OR unit_price_krw >= 0);

-- VAT 비율은 0~1 사이 (0%~100%).
ALTER TABLE quotes
  ADD CONSTRAINT quotes_vat_rate_range
  CHECK (vat_rate IS NULL OR (vat_rate >= 0 AND vat_rate <= 1));

-- MOQ는 양수.
ALTER TABLE quotes
  ADD CONSTRAINT quotes_moq_positive
  CHECK (moq IS NULL OR moq > 0);

-- ────────────────────────────────────────────────────────────
-- 3. 인덱스 — 상품별 견적 비교 조회 성능 (F-1e)
-- ────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS quotes_product_status_idx
  ON quotes (product_id, status);

-- 벌크 임포트 중복 방지 참고용 (회사 + 파일명 + 행번호)
CREATE INDEX IF NOT EXISTS quotes_source_import_idx
  ON quotes (company_id, source_file_name, source_row);

-- ────────────────────────────────────────────────────────────
-- 4. 주석
-- ────────────────────────────────────────────────────────────
COMMENT ON COLUMN quotes.unit_price_krw IS
  '공급단가(원화) — 국내 수입 대행업체 거래의 주력 컬럼. VAT 별도/포함은 vat_included 참조.';
COMMENT ON COLUMN quotes.vat_included IS
  '단가에 VAT가 포함됐는지. false면 별도(사장님 케이스 기본).';
COMMENT ON COLUMN quotes.source_file_name IS
  'F-2 벌크 임포트 시 원본 파일명. 수동 입력 시 NULL.';
COMMENT ON COLUMN quotes.source_row IS
  'F-2 벌크 임포트 시 엑셀의 행 번호(1-based, 헤더 제외). 재임포트 방지용.';
