export default function Loading() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-navy-200 border-t-teal-600" />
        <p className="text-sm text-navy-500">불러오는 중...</p>
      </div>
    </div>
  );
}
