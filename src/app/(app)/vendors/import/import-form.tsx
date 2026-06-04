/**
 * 농가 CSV 임포트 폼 (클라이언트)
 *
 * 출처: docs/proposals/농가-공급처-PR분할.md §1번 PR
 * 헌법: CLAUDE.md §1 P-9
 *
 * 흐름:
 *   1. 파일 선택
 *   2. "미리보기" 클릭 → POST /api/vendors/import/preview → 통계 + 처음 100건 카드
 *   3. "확정" 클릭 → POST /api/vendors/import/confirm → 통계 + 토스트
 */
'use client';

import { useRef, useState } from 'react';

import { AlertCircle, CheckCircle2, FileText, Loader2, Upload } from 'lucide-react';
import { toast } from 'sonner';

interface PreviewStats {
  total: number;
  new: number;
  updated: number;
  skipped: number;
  matchedByBizNo: number;
  matchedByNameAddress: number;
  matchedByNameRep: number;
}

interface PreviewRow {
  rawIndex: number;
  source_site: string;
  biz_name: string;
  biz_no: string | null;
  matchKind: 'biz_no' | 'name+address' | 'name+rep' | 'new';
  existingVendorName: string | null;
  alsoListedOn: string | null;
  keywordCount: number;
  errors: string[];
}

interface HeaderAnalysis {
  detected: Array<{ field: string; index: number; csvHeader: string }>;
  ignored: Array<{ index: number; csvHeader: string }>;
  missing: string[];
}

interface PreviewResponseOk {
  ok: true;
  headerAnalysis: HeaderAnalysis;
  stats: PreviewStats;
  previewRows: PreviewRow[];
  totalRows: number;
}

interface PreviewResponseErr {
  ok: false;
  error: string;
  headerAnalysis?: HeaderAnalysis;
}

interface ConfirmResponseOk {
  ok: true;
  stats: PreviewStats;
  applied: {
    insertedVendors: number;
    updatedVendors: number;
    insertedKeywords: number;
  };
}

const MATCH_LABEL: Record<PreviewRow['matchKind'], string> = {
  new: '신규',
  biz_no: '사업자번호 일치',
  'name+address': '업체명+주소 일치',
  'name+rep': '업체명+대표자 일치',
};

const MATCH_COLOR: Record<PreviewRow['matchKind'], string> = {
  new: 'bg-blue-50 text-blue-700 border-blue-200',
  biz_no: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  'name+address': 'bg-amber-50 text-amber-700 border-amber-200',
  'name+rep': 'bg-amber-50 text-amber-700 border-amber-200',
};

export function ImportForm() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [previewResult, setPreviewResult] = useState<PreviewResponseOk | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    setFile(f ?? null);
    setPreviewResult(null);
    setErrorMsg(null);
  }

  async function handlePreview() {
    if (!file) {
      toast.error('먼저 CSV 파일을 선택해주세요');
      return;
    }

    setPreviewing(true);
    setErrorMsg(null);
    setPreviewResult(null);

    try {
      const fd = new FormData();
      fd.append('file', file);

      const res = await fetch('/api/vendors/import/preview', {
        method: 'POST',
        body: fd,
      });

      const json = (await res.json()) as PreviewResponseOk | PreviewResponseErr;

      if (!res.ok || !json.ok) {
        setErrorMsg(json.ok === false ? json.error : `미리보기 실패 (${res.status})`);
        return;
      }

      setPreviewResult(json);
      toast.success(`${json.totalRows}건 분석 완료`);
    } catch (err) {
      console.error('[import] preview error', err);
      setErrorMsg(err instanceof Error ? err.message : '네트워크 오류');
    } finally {
      setPreviewing(false);
    }
  }

  async function handleConfirm() {
    if (!file || !previewResult) return;
    if (previewResult.stats.new === 0 && previewResult.stats.updated === 0) {
      toast.warning('추가/업데이트할 row 가 없습니다');
      return;
    }

    if (
      !confirm(
        `정말 임포트하시겠어요?\n\n신규 ${previewResult.stats.new}건 / 업데이트 ${previewResult.stats.updated}건`,
      )
    ) {
      return;
    }

    setConfirming(true);
    setErrorMsg(null);

    try {
      const fd = new FormData();
      fd.append('file', file);

      const res = await fetch('/api/vendors/import/confirm', {
        method: 'POST',
        body: fd,
      });

      const json = (await res.json()) as ConfirmResponseOk | { ok: false; error: string };

      if (!res.ok || !json.ok) {
        setErrorMsg(json.ok === false ? json.error : `확정 실패 (${res.status})`);
        return;
      }

      toast.success(
        `임포트 완료: 신규 ${json.applied.insertedVendors} / 업데이트 ${json.applied.updatedVendors} / 키워드 ${json.applied.insertedKeywords}`,
      );

      // 초기화
      setFile(null);
      setPreviewResult(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    } catch (err) {
      console.error('[import] confirm error', err);
      setErrorMsg(err instanceof Error ? err.message : '네트워크 오류');
    } finally {
      setConfirming(false);
    }
  }

  return (
    <section className="space-y-6 rounded-lg border border-navy-200 bg-white p-6">
      <h2 className="flex items-center gap-2 text-lg font-semibold text-navy-900">
        <Upload className="h-5 w-5 text-emerald-600" />
        CSV 업로드
      </h2>

      {/* 파일 선택 */}
      <div className="flex flex-wrap items-center gap-3">
        <label
          htmlFor="csv-file"
          className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-navy-300 bg-white px-4 py-2 text-sm font-medium text-navy-700 hover:bg-navy-50"
        >
          <FileText className="h-4 w-4" />
          {file ? file.name : '파일 선택'}
          <input
            ref={fileInputRef}
            id="csv-file"
            type="file"
            accept=".csv,text/csv"
            onChange={handleFileChange}
            className="hidden"
          />
        </label>

        {file && (
          <span className="text-xs text-navy-500">
            크기 {(file.size / 1024).toFixed(1)} KB
          </span>
        )}

        <button
          type="button"
          onClick={handlePreview}
          disabled={!file || previewing}
          className="inline-flex items-center gap-2 rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {previewing ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              분석 중...
            </>
          ) : (
            <>미리보기</>
          )}
        </button>

        {previewResult && (
          <button
            type="button"
            onClick={handleConfirm}
            disabled={confirming}
            className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {confirming ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                저장 중...
              </>
            ) : (
              <>
                <CheckCircle2 className="h-4 w-4" />
                확정 (저장)
              </>
            )}
          </button>
        )}
      </div>

      {/* 에러 메시지 */}
      {errorMsg && (
        <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <div className="flex-1">
            <div className="font-medium">오류</div>
            <div>{errorMsg}</div>
          </div>
        </div>
      )}

      {/* 결과 */}
      {previewResult && (
        <div className="space-y-5">
          {/* 헤더 인식 */}
          <div className="rounded-md bg-navy-50/40 p-4 text-sm">
            <h3 className="mb-2 font-semibold text-navy-800">헤더 인식</h3>
            <div className="grid gap-3 md:grid-cols-3">
              <div>
                <div className="text-xs font-semibold text-navy-500">
                  인식됨 ({previewResult.headerAnalysis.detected.length})
                </div>
                <ul className="mt-1 space-y-0.5 text-xs">
                  {previewResult.headerAnalysis.detected.slice(0, 12).map((d) => (
                    <li key={d.index}>
                      <code className="text-emerald-700">{d.csvHeader}</code>
                      <span className="text-navy-400">{' → '}</span>
                      <code className="text-navy-700">{d.field}</code>
                    </li>
                  ))}
                  {previewResult.headerAnalysis.detected.length > 12 && (
                    <li className="text-navy-400">...외 {previewResult.headerAnalysis.detected.length - 12}개</li>
                  )}
                </ul>
              </div>
              {previewResult.headerAnalysis.ignored.length > 0 && (
                <div>
                  <div className="text-xs font-semibold text-navy-500">
                    무시됨 ({previewResult.headerAnalysis.ignored.length})
                  </div>
                  <ul className="mt-1 space-y-0.5 text-xs text-navy-400">
                    {previewResult.headerAnalysis.ignored.slice(0, 8).map((i) => (
                      <li key={i.index}>{i.csvHeader || '(빈 컬럼명)'}</li>
                    ))}
                  </ul>
                </div>
              )}
              {previewResult.headerAnalysis.missing.length > 0 && (
                <div>
                  <div className="text-xs font-semibold text-red-600">
                    필수 누락
                  </div>
                  <ul className="mt-1 space-y-0.5 text-xs text-red-700">
                    {previewResult.headerAnalysis.missing.map((m) => (
                      <li key={m}>{m}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>

          {/* 통계 카드 */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatCard label="전체" value={previewResult.stats.total} color="text-navy-700" />
            <StatCard label="신규" value={previewResult.stats.new} color="text-blue-600" />
            <StatCard label="업데이트" value={previewResult.stats.updated} color="text-emerald-600" />
            <StatCard label="스킵" value={previewResult.stats.skipped} color="text-amber-600" />
          </div>

          {/* 매칭 방식별 */}
          {previewResult.stats.updated > 0 && (
            <div className="rounded-md border border-navy-200 bg-white p-4 text-sm">
              <h3 className="mb-2 font-semibold text-navy-800">기존 농가와 매칭된 방식</h3>
              <ul className="space-y-1 text-xs text-navy-600">
                <li>
                  사업자번호 일치: <strong>{previewResult.stats.matchedByBizNo}</strong>
                </li>
                <li>
                  업체명+주소 일치: <strong>{previewResult.stats.matchedByNameAddress}</strong>
                </li>
                <li>
                  업체명+대표자 일치: <strong>{previewResult.stats.matchedByNameRep}</strong>
                </li>
              </ul>
            </div>
          )}

          {/* 처음 30건 미리보기 */}
          <div className="rounded-md border border-navy-200 bg-white">
            <h3 className="border-b border-navy-200 px-4 py-2 text-sm font-semibold text-navy-800">
              처음 30건 미리보기 ({previewResult.previewRows.length}건 중)
            </h3>
            <div className="max-h-96 overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-navy-50 text-navy-700">
                  <tr>
                    <th className="px-3 py-2 text-left">#</th>
                    <th className="px-3 py-2 text-left">업체명</th>
                    <th className="px-3 py-2 text-left">사업자번호</th>
                    <th className="px-3 py-2 text-left">매칭</th>
                    <th className="px-3 py-2 text-left">키워드</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-navy-100">
                  {previewResult.previewRows.slice(0, 30).map((r) => (
                    <tr key={r.rawIndex} className="hover:bg-navy-50/30">
                      <td className="px-3 py-1.5 text-navy-400">{r.rawIndex}</td>
                      <td className="px-3 py-1.5 font-medium text-navy-900">{r.biz_name}</td>
                      <td className="px-3 py-1.5 text-navy-600">{r.biz_no ?? '-'}</td>
                      <td className="px-3 py-1.5">
                        <span
                          className={`rounded border px-1.5 py-0.5 text-xs ${MATCH_COLOR[r.matchKind]}`}
                        >
                          {MATCH_LABEL[r.matchKind]}
                        </span>
                        {r.existingVendorName && (
                          <span className="ml-1 text-navy-500">
                            → {r.existingVendorName}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-1.5 text-navy-500">{r.keywordCount}개</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="rounded-md border border-navy-200 bg-white p-3 text-center">
      <div className={`text-2xl font-bold ${color}`}>{value.toLocaleString()}</div>
      <div className="text-xs text-navy-500">{label}</div>
    </div>
  );
}
