export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="max-w-4xl mx-auto px-4 py-8">{children}</main>
  );
}
