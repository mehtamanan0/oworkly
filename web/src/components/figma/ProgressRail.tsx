export function ProgressRail({ steps, currentIndex }: { steps: string[]; currentIndex: number }) {
  return (
    <div className="flex items-center gap-2 border-b border-fig-border bg-white px-4 py-3">
      {steps.map((step, i) => (
        <div key={step} className="flex flex-1 items-center gap-2">
          <span className={`text-xs font-medium ${i === currentIndex ? "text-fig-blue" : i < currentIndex ? "text-fig-green" : "text-fig-muted"}`}>
            {step}
          </span>
          {i < steps.length - 1 && <span className={`h-0.5 flex-1 rounded ${i < currentIndex ? "bg-fig-green" : i === currentIndex ? "bg-fig-blue" : "bg-fig-border"}`} />}
        </div>
      ))}
      <span className="ml-2 shrink-0 text-xs font-medium text-fig-muted">
        {currentIndex + 1}/{steps.length}
      </span>
    </div>
  );
}
