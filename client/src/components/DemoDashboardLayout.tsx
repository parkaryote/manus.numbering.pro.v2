export default function DemoDashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-background">
      <main className="flex-1 overflow-y-auto p-6">
        {children}
      </main>
    </div>
  );
}
