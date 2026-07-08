/**
 * Remounts on every navigation (unlike layout), so its mount animation
 * gives each view a quick fade-in phase.
 */
export default function Template({ children }: { children: React.ReactNode }) {
  return (
    <div className="animate-fadein motion-reduce:animate-none">{children}</div>
  );
}
