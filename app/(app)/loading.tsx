export default function AppLoading() {
  return (
    <div aria-busy="true" aria-label="Loading" className="page-enter">
      <div className="skeleton mb-2 h-8 w-56" />
      <div className="skeleton mb-6 h-4 w-80" />
      <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-stone-200 bg-white p-5">
            <div className="skeleton h-3 w-20" />
            <div className="skeleton mt-2.5 h-7 w-14" />
            <div className="skeleton mt-2 h-3 w-24" />
          </div>
        ))}
      </div>
      <div className="mt-4 rounded-xl border border-stone-200 bg-white p-5">
        <div className="skeleton h-4 w-40" />
        <div className="skeleton mt-3 h-4 w-full" />
        <div className="skeleton mt-2 h-4 w-5/6" />
        <div className="skeleton mt-2 h-4 w-4/6" />
      </div>
    </div>
  );
}
