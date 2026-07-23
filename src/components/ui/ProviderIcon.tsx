import { providerIcons, type ProviderIconName } from "../../lib/providerIcons";

interface ProviderIconProps {
  provider: ProviderIconName;
  className?: string;
  scale?: number;
}

export function ProviderIcon({
  provider,
  className = "h-4 w-4",
  scale = 1
}: ProviderIconProps) {
  return (
    <span
      className={`${className} shrink-0 bg-current`}
      aria-hidden="true"
      style={{
        WebkitMask: `url("${providerIcons[provider]}") center / contain no-repeat`,
        mask: `url("${providerIcons[provider]}") center / contain no-repeat`,
        transform: scale === 1 ? undefined : `scale(${scale})`,
        transformOrigin: scale === 1 ? undefined : "center"
      }}
    />
  );
}
