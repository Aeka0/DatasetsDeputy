import { cn } from "../../lib/cn";

interface DialogTitleWithDatasetProps {
  id?: string;
  title: string;
  datasetPathLabel?: string;
  className?: string;
}

export function DialogTitleWithDataset({
  id,
  title,
  datasetPathLabel,
  className
}: DialogTitleWithDatasetProps) {
  return (
    <h2
      id={id}
      className={cn(
        "m-0 flex min-w-0 items-baseline gap-2 text-[15px] leading-6 text-neutral-950",
        className
      )}
    >
      <span className="shrink-0 font-semibold">{title}</span>
      {datasetPathLabel ? (
        <span
          className="min-w-0 truncate text-[13px] font-normal text-neutral-500"
          title={datasetPathLabel}
        >
          {datasetPathLabel}
        </span>
      ) : null}
    </h2>
  );
}
