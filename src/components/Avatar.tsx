// No real profile photos yet — a colored initial stands in, keyed off each
// user's seeded avatarColor so it's at least consistent per-person.
export default function Avatar({
  displayName,
  color,
  size = "md",
}: {
  displayName: string;
  color: string;
  size?: "sm" | "md" | "lg";
}) {
  const dimensions =
    size === "sm" ? "h-8 w-8 text-xs" : size === "lg" ? "h-16 w-16 text-xl" : "h-10 w-10 text-sm";

  return (
    <div
      className={`flex shrink-0 items-center justify-center rounded-full font-semibold text-white ${dimensions}`}
      style={{ backgroundColor: color }}
      aria-hidden
    >
      {displayName.charAt(0).toUpperCase()}
    </div>
  );
}
