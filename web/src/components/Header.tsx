/** Section header: red Doto kicker, big Doto title, one paragraph of copy, an optional right-hand slot. */
export function Header({ kicker, title, copy, right }: { kicker: string; title: string; copy: string; right?: React.ReactNode }) {
  return (
    <div className="mb-8 grid gap-4 md:grid-cols-[auto_1fr] md:items-end">
      <div>
        <div className="display text-red text-sm">{kicker}</div>
        <h2 className="display text-[clamp(32px,6vw,72px)] mt-1">{title}</h2>
      </div>
      <div className="md:justify-self-end md:text-right flex flex-col md:items-end gap-3">
        <p className="text-fg-2 max-w-2xl">{copy}</p>
        {right}
      </div>
    </div>
  );
}
