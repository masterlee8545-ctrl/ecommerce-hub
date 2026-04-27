/**
 * /research/sello → /research 로 리다이렉트
 * (과거 분리 페이지였지만 /research 에 통합됨)
 */
import { redirect } from 'next/navigation';

export default function SelloRedirect(): never {
  redirect('/research');
}
