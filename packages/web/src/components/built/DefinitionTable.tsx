import type { ReactElement, ReactNode } from "react";

export interface DefinitionRow {
  term: ReactNode;
  def: ReactNode;
}

export interface DefinitionTableProps {
  rows: readonly DefinitionRow[];
  ariaLabel?: string;
}

export function DefinitionTable({
  rows,
  ariaLabel,
}: DefinitionTableProps): ReactElement {
  return (
    <table className="w-full border-collapse" aria-label={ariaLabel}>
      <tbody>
        {rows.map((row, idx) => (
          <tr
            key={idx}
            className="border-t border-[#e7e2d6] last:border-b last:border-[#e7e2d6]"
          >
            <td className="py-[18px] pr-7 align-top w-[140px] md:w-[210px] font-mono text-[12px] md:text-[13px] tracking-[0.04em] text-[#14110d]">
              {row.term}
            </td>
            <td className="py-[18px] align-top font-serif text-[16px] md:text-[17.5px] leading-[1.55] text-[#14110d]">
              {row.def}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
