-- ============================================================
-- 0015_products_supply_columns.sql — products 컬럼 6개 추가 (ADR-012)
-- ============================================================
-- 출처: src/db/schema/products.ts, docs/proposals/농가-공급처-DATA_MODEL-변경분.md §3.1
-- 헌법: CLAUDE.md §1 P-6 (마이그레이션은 새 파일만 추가, 옛 파일 수정 금지)
-- ADR: ADR-012 D-2 (supply_type 으로 공급망 분기), D-5 (시즌 메타 연계)
--
-- 동기:
--   - 상품마다 농가/도매상 어느 쪽 탭을 노출할지 결정 (supply_type)
--   - 시즌 펄스에서 담을 때 시즌 메타 자동 채움 (peak/prep/ratio/score)
--   - 농가 확정 후 primary_vendor_id 로 연결 (suppliers 와 별개)
--
-- 컬럼은 모두 nullable → 무중단 적용 가능 (기존 row 영향 없음).
--
-- 본격 활용:
--   - supply_type / primary_vendor_id : 2번 PR (공급처 찾기 탭)
--   - season_* : 5번 PR (시즌 펄스 → 담기 시 자동 채움)
-- ============================================================

-- ─── 공급망 분기 ───
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS supply_type text;

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS primary_vendor_id uuid REFERENCES vendors(id);

-- ─── 시즌 메타 (시즌 펄스 연계) ───
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS season_peak_month integer;

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS season_prep_month integer;

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS seasonality_ratio numeric(5, 2);

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS season_score integer;

-- ─── 제약 ───
ALTER TABLE products
  DROP CONSTRAINT IF EXISTS products_supply_type_check;
ALTER TABLE products
  ADD CONSTRAINT products_supply_type_check
    CHECK (supply_type IS NULL OR supply_type IN ('domestic_vendor', 'overseas_supplier', 'both'));

ALTER TABLE products
  DROP CONSTRAINT IF EXISTS products_season_peak_month_check;
ALTER TABLE products
  ADD CONSTRAINT products_season_peak_month_check
    CHECK (season_peak_month IS NULL OR (season_peak_month BETWEEN 1 AND 12));

ALTER TABLE products
  DROP CONSTRAINT IF EXISTS products_season_prep_month_check;
ALTER TABLE products
  ADD CONSTRAINT products_season_prep_month_check
    CHECK (season_prep_month IS NULL OR (season_prep_month BETWEEN 1 AND 12));

ALTER TABLE products
  DROP CONSTRAINT IF EXISTS products_season_score_check;
ALTER TABLE products
  ADD CONSTRAINT products_season_score_check
    CHECK (season_score IS NULL OR season_score IN (1, 2, 4, 5));

-- ─── 인덱스 (partial — NULL 많을 거라 효율 위해) ───
CREATE INDEX IF NOT EXISTS idx_products_supply_type
  ON products(supply_type) WHERE supply_type IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_products_primary_vendor
  ON products(primary_vendor_id) WHERE primary_vendor_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_products_season_prep
  ON products(season_prep_month) WHERE season_prep_month IS NOT NULL;
