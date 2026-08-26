type AppIconProps = {
  size?: number;
  className?: string;
};

export default function AppIcon({ size = 16, className = "" }: AppIconProps) {
  return (
    <img
      src="/icon.svg"
      alt=""
      width={size}
      height={size}
      draggable={false}
      className={`shrink-0 select-none ${className}`}
      aria-hidden
    />
  );
}
