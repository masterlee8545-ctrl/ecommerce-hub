/**
 * 시드 스크립트 — 초기 데이터 자동 입력
 *
 * 출처: docs/DATA_MODEL.md §2.1 (회사 3개), §5.3 (관세 프리셋 4종)
 * 헌법: CLAUDE.md §1 P-4 (멀티테넌트), §1 P-7 (비밀번호 평문 금지)
 *
 * 역할:
 * - 새로 만든 빈 데이터베이스에 필수 초기 데이터를 한 번에 채워 넣는다.
 * - 두 번째 실행해도 안전하다 (이미 있으면 건너뜀 — 멱등성).
 *
 * 심는 데이터:
 *   1) BUYWISE.CO 산하 3개 회사
 *      - 바이와이즈 (주)   — industrial   (생활/공산품)
 *      - 유어밸류 (주)     — agricultural (농산물)
 *      - 유어옵티멀 (주)   — other        (기타)
 *   2) 각 회사마다 관세 프리셋 4종 (총 12개)
 *      - 생활용품 8% / 의류 13% / 가전 소품 8% / 무관세 0%
 *   3) 관리자 계정 1개 (3개 회사 모두에 owner 권한)
 *      - 이메일: admin@buywise.co
 *      - 비밀번호: BUYWISE!2026 (최초 로그인 후 즉시 변경 권장)
 *
 * 실행 방법:
 *   npm run db:seed
 *
 * 안전 장치:
 * - 트랜잭션으로 전부 묶음 → 중간에 실패하면 전부 롤백
 * - 멱등성: 회사 이름 / 사용자 이메일 / (회사+프리셋이름) / (회사+사용자) 기준 중복 감지
 * - 환경변수 SEED_ADMIN_PASSWORD가 있으면 그 값을 우선 사용 (운영 환경 안전)
 *
 * 변경 금지: 시드 데이터는 시스템 무결성의 일부 — 함부로 바꾸지 말 것.
 */
import { and, eq } from 'drizzle-orm';

import { db } from '@/db';
import { companies, tariffPresets, userCompanies, users } from '@/db/schema';
import { hashPassword } from '@/lib/auth/password';

// ────────────────────────────────────────────────────────────
// 1. 시드할 회사 명세
// ────────────────────────────────────────────────────────────
interface CompanySeed {
  name: string;
  business_type: 'industrial' | 'agricultural' | 'other';
  representative: string;
  default_currency: 'KRW';
}

const COMPANIES_TO_SEED: CompanySeed[] = [
  {
    name: '바이와이즈 (주)',
    business_type: 'industrial',
    representative: '이재홍',
    default_currency: 'KRW',
  },
  {
    name: '유어밸류 (주)',
    business_type: 'agricultural',
    representative: '이재홍',
    default_currency: 'KRW',
  },
  {
    name: '유어옵티멀 (주)',
    business_type: 'other',
    representative: '이재홍',
    default_currency: 'KRW',
  },
];

// ────────────────────────────────────────────────────────────
// 2. 시드할 관세 프리셋 명세
// ────────────────────────────────────────────────────────────
// 주의: tariff_rate / vat_rate는 decimal(5,4) → 0.0800 = 8%, 0.1000 = 10%
//       drizzle decimal 컬럼은 string으로 전달하는 것이 표준 (정밀도 보존)
interface TariffSeed {
  name: string;
  category: string;
  tariff_rate: string;
  vat_rate: string;
  description: string;
}

const TARIFFS_TO_SEED: TariffSeed[] = [
  {
    name: '생활용품 8%',
    category: '생활/잡화',
    tariff_rate: '0.0800',
    vat_rate: '0.1000',
    description: '일반 생활용품, 주방/욕실 잡화 등 — 관세 8% + 부가세 10%',
  },
  {
    name: '의류 13%',
    category: '의류/패션',
    tariff_rate: '0.1300',
    vat_rate: '0.1000',
    description: '의류, 신발, 가방 등 — 관세 13% + 부가세 10%',
  },
  {
    name: '가전 소품 8%',
    category: '가전/전자',
    tariff_rate: '0.0800',
    vat_rate: '0.1000',
    description: '소형 가전, 전자 액세서리 — 관세 8% + 부가세 10%',
  },
  {
    name: '무관세 0%',
    category: '무관세 품목',
    tariff_rate: '0.0000',
    vat_rate: '0.1000',
    description: 'FTA 적용 또는 무관세 품목 — 관세 0% + 부가세 10%',
  },
];

// ────────────────────────────────────────────────────────────
// 3. 관리자 계정 명세
// ────────────────────────────────────────────────────────────
const ADMIN_EMAIL = 'admin@buywise.co';
const ADMIN_NAME = '시스템 관리자';
const ADMIN_DEFAULT_PASSWORD = 'BUYWISE!2026';

// ────────────────────────────────────────────────────────────
// 메인 시드 함수
// ────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  console.log('[seed] 시작 — BUYWISE.CO 초기 데이터 입력');

  // 비밀번호: 환경변수 우선 (운영 환경 안전), 없으면 기본값
  const adminPassword = process.env['SEED_ADMIN_PASSWORD'] ?? ADMIN_DEFAULT_PASSWORD;
  const adminPasswordHash = await hashPassword(adminPassword);

  // 트랜잭션 1개로 전부 묶음 — 실패 시 전부 롤백
  await db.transaction(async (tx) => {
    // ────────────────────────────────────────────────
    // 1) 회사 3개 upsert
    // ────────────────────────────────────────────────
    const companyIds: string[] = [];

    for (const seed of COMPANIES_TO_SEED) {
      // 같은 이름이 있으면 그 id를 재사용 (멱등성)
      const existing = await tx
        .select({ id: companies.id })
        .from(companies)
        .where(eq(companies.name, seed.name))
        .limit(1);

      if (existing[0]) {
        companyIds.push(existing[0].id);
        console.log(`[seed] 회사 건너뜀 (이미 존재): ${seed.name}`);
        continue;
      }

      const inserted = await tx
        .insert(companies)
        .values({
          name: seed.name,
          business_type: seed.business_type,
          representative: seed.representative,
          default_currency: seed.default_currency,
        })
        .returning({ id: companies.id });

      const newId = inserted[0]?.id;
      if (!newId) {
        throw new Error(`[seed] 회사 INSERT 후 id를 받지 못함: ${seed.name}`);
      }
      companyIds.push(newId);
      console.log(`[seed] 회사 생성: ${seed.name} (${newId})`);
    }

    // ────────────────────────────────────────────────
    // 2) 회사별 관세 프리셋 4종 upsert (총 12개)
    // ────────────────────────────────────────────────
    let tariffCreatedCount = 0;
    let tariffSkippedCount = 0;

    for (const companyId of companyIds) {
      for (const seed of TARIFFS_TO_SEED) {
        // (회사 + 프리셋 이름) 조합으로 중복 감지
        const existing = await tx
          .select({ id: tariffPresets.id })
          .from(tariffPresets)
          .where(
            and(eq(tariffPresets.company_id, companyId), eq(tariffPresets.name, seed.name)),
          )
          .limit(1);

        if (existing[0]) {
          tariffSkippedCount += 1;
          continue;
        }

        await tx.insert(tariffPresets).values({
          company_id: companyId,
          name: seed.name,
          category: seed.category,
          tariff_rate: seed.tariff_rate,
          vat_rate: seed.vat_rate,
          description: seed.description,
        });
        tariffCreatedCount += 1;
      }
    }
    console.log(
      `[seed] 관세 프리셋: ${tariffCreatedCount}개 생성 / ${tariffSkippedCount}개 건너뜀`,
    );

    // ────────────────────────────────────────────────
    // 3) 관리자 사용자 1명 upsert
    // ────────────────────────────────────────────────
    const existingAdmin = await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, ADMIN_EMAIL))
      .limit(1);

    let adminUserId: string;
    if (existingAdmin[0]) {
      adminUserId = existingAdmin[0].id;
      console.log(`[seed] 관리자 건너뜀 (이미 존재): ${ADMIN_EMAIL}`);
    } else {
      const firstCompanyId = companyIds[0];
      if (!firstCompanyId) {
        throw new Error('[seed] 회사가 한 개도 없음 — 관리자 생성 불가');
      }

      const insertedAdmin = await tx
        .insert(users)
        .values({
          email: ADMIN_EMAIL,
          name: ADMIN_NAME,
          password_hash: adminPasswordHash,
          active_company_id: firstCompanyId, //   기본 활성 회사 = 첫 번째
          is_active: true,
        })
        .returning({ id: users.id });

      const newAdminId = insertedAdmin[0]?.id;
      if (!newAdminId) {
        throw new Error('[seed] 관리자 INSERT 후 id를 받지 못함');
      }
      adminUserId = newAdminId;
      console.log(`[seed] 관리자 생성: ${ADMIN_EMAIL} (${adminUserId})`);
    }

    // ────────────────────────────────────────────────
    // 4) 관리자를 모든 회사에 owner로 연결
    // ────────────────────────────────────────────────
    let memberCreatedCount = 0;
    let memberSkippedCount = 0;

    for (const companyId of companyIds) {
      // (사용자 + 회사) 조합으로 중복 감지
      const existing = await tx
        .select({ id: userCompanies.id })
        .from(userCompanies)
        .where(
          and(
            eq(userCompanies.user_id, adminUserId),
            eq(userCompanies.company_id, companyId),
          ),
        )
        .limit(1);

      if (existing[0]) {
        memberSkippedCount += 1;
        continue;
      }

      await tx.insert(userCompanies).values({
        user_id: adminUserId,
        company_id: companyId,
        role: 'owner',
      });
      memberCreatedCount += 1;
    }
    console.log(
      `[seed] 회사-사용자 연결: ${memberCreatedCount}개 생성 / ${memberSkippedCount}개 건너뜀`,
    );
  });

  console.log('[seed] 완료 ✅');
  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  로그인 정보 (최초 1회용 — 즉시 변경 권장)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  이메일:   ${ADMIN_EMAIL}`);
  console.log(`  비밀번호: ${adminPassword}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
}

// ────────────────────────────────────────────────────────────
// 진입점
// ────────────────────────────────────────────────────────────
main()
  .then(() => {
    process.exit(0);
  })
  .catch((error: unknown) => {
    console.error('[seed] 실패:', error);
    process.exit(1);
  });
